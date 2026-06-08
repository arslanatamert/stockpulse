// Cron job #1 — runs at 3:00 AM UTC Mon–Fri (4 AM CET / 5 AM CEST).
// Fetches price + fundamental + news data for all stocks, builds Claude prompts,
// submits them as an Anthropic Batch, then stores the batch ID + stock snapshot
// in Upstash Redis (TTL 6h) for the send job to retrieve at 7 AM UTC.

import { buildPrompt } from '../lib/buildPrompt.js';
import { fetchFmpFundamentals } from '../lib/fetchFmp.js';
import { fetchFtsePool } from '../lib/fetchFtsePool.js';

export const config = { maxDuration: 60 };

const YH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
  'Referer': 'https://finance.yahoo.com/',
};

const STOCKS = [
  { sym: 'AIR.DE',   label: 'Airbus'          },
  { sym: 'DTE.DE',   label: 'Deutsche Telekom' },
  { sym: 'ALV.DE',   label: 'Allianz'          },
  { sym: 'RACE.MI',  label: 'Ferrari'          },
  { sym: 'NTO.F',    label: 'Nintendo'         },
  { sym: '6RJ0.F',   label: 'Rocket Lab'       },
  { sym: '3ZU0.F',   label: 'AST SpaceMobile'  },
  { sym: '0YB0.F',   label: 'IonQ'             },
  { sym: 'A00.F',    label: 'Rigetti'          },
  { sym: 'RQ0.F',    label: 'D-Wave'           },
  { sym: 'QUBT',     label: 'QUBT'             },
  { sym: 'BTC-EUR',  label: 'Bitcoin'          },
  { sym: 'ETH-EUR',  label: 'Ethereum'         },
  { sym: 'SOL-EUR',  label: 'Solana'           },
  { sym: 'MATIC-EUR',label: 'Polygon'          },
];

// Deterministic Fisher-Yates shuffle seeded by an integer (LCG).
// Using today's UTC date as seed keeps the selection stable across retries
// but rotates to a different 10 each calendar day.
function seededSample(arr, n, seed) {
  const a = [...arr];
  let s = seed >>> 0;
  for (let i = a.length - 1; i > 0; i--) {
    s = Math.imul(s, 1664525) + 1013904223 >>> 0;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

function dailySeed() {
  const d = new Date();
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

function parseRss(text, sourceLabel) {
  return [...text.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 8).map(m => {
    const b = m[1];
    const get = t => {
      const x = b.match(new RegExp(`<${t}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${t}>|<${t}[^>]*>([\\s\\S]*?)<\\/${t}>`));
      return x ? (x[1] || x[2] || '').trim() : '';
    };
    return { title: get('title'), source: sourceLabel };
  }).filter(i => i.title);
}

async function upstashSet(key, value, ttlSeconds) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return;
  await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([['SET', key, value, 'EX', ttlSeconds]]),
  });
}

export default async function handler(req, res) {
  const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

  // Vercel cron sends Authorization: Bearer {CRON_SECRET}. Also accept ?secret= for manual testing.
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers['authorization'];
  const querySecret = req.query?.secret;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}` && querySecret !== cronSecret) {
    return res.setHeader('Content-Type', 'application/json').status(401).json({ error: 'Unauthorized' });
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return res.setHeader('Content-Type', 'application/json').status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
  }

  // Allow custom stocks via request body: [{ sym: "AAPL", label: "Apple" }, ...]
  // Falls back to the default 15 + 10 daily FTSE All-World picks if not provided.
  let stocks;
  if (req.body?.stocks && Array.isArray(req.body.stocks) && req.body.stocks.length > 0) {
    const invalid = req.body.stocks.find(s => !s.sym || !s.label);
    if (invalid) {
      return res.setHeader('Content-Type', 'application/json').status(400).json({
        error: 'Each stock must have { sym, label }',
      });
    }
    stocks = req.body.stocks;
  } else {
    const pool   = await fetchFtsePool();
    const daily10 = seededSample(pool, 10, dailySeed());
    stocks = [...STOCKS, ...daily10];
  }

  // --- Step 1: Fetch Yahoo Finance price data for all stocks in parallel ---
  const priceData = await Promise.all(stocks.map(async ({ sym, label }) => {
    try {
      const [r1d, r1y] = await Promise.all([
        fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${sym}?interval=5m&range=1d`,  { headers: YH_HEADERS }),
        fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=1y`,  { headers: YH_HEADERS }),
      ]);
      const d1d = r1d.ok ? await r1d.json() : null;
      const d1y = r1y.ok ? await r1y.json() : null;
      const m1d = d1d?.chart?.result?.[0]?.meta || {};
      const m1y = d1y?.chart?.result?.[0]?.meta || {};
      const meta = m1y.regularMarketPrice ? m1y : m1d;
      return {
        sym, label,
        price:     meta.regularMarketPrice    || null,
        prevClose: m1d.chartPreviousClose     || m1d.previousClose || null,
        high52:    meta.fiftyTwoWeekHigh      || null,
        low52:     meta.fiftyTwoWeekLow       || null,
        currency:  meta.currency              || 'EUR',
        name:      meta.longName || meta.shortName || label,
      };
    } catch { return { sym, label, error: true }; }
  }));

  const validStocks = priceData.filter(s => !s.error && s.price);

  // --- Step 2: Fetch FMP fundamentals + Yahoo RSS news in parallel per stock ---
  // Crypto tickers don't have FMP data; Yahoo RSS news is always attempted.
  const enriched = await Promise.all(validStocks.map(async stock => {
    const isCrypto = stock.sym.includes('-EUR') || stock.sym.includes('-USD');
    const [fmp, rssRes] = await Promise.all([
      isCrypto ? Promise.resolve({}) : fetchFmpFundamentals(stock.sym, stock.sym),
      fetch(`https://feeds.finance.yahoo.com/rss/2.0/headline?s=${stock.sym}&region=US&lang=en-US`, { headers: YH_HEADERS })
        .catch(() => null),
    ]);

    let news = [];
    if (rssRes?.ok) {
      try { news = parseRss(await rssRes.text(), 'Yahoo Finance'); } catch {}
    }

    return { ...stock, ...fmp, news };
  }));

  // --- Step 3: Build Anthropic Batch request payload ---
  const requests = enriched.map(stock => {
    const { system, user } = buildPrompt({
      name:              stock.name,
      symbol:            stock.sym,
      currency:          stock.currency,
      price:             stock.price,
      prevClose:         stock.prevClose,
      high52:            stock.high52,
      low52:             stock.low52,
      pe:                stock.pe,
      marketCap:         stock.marketCap,
      avgVolume:         stock.avgVolume,
      dividendYield:     stock.dividendYield,
      eps:               stock.eps,
      bookValuePerShare: stock.bookValuePerShare,
      pbRatio:           stock.pbRatio,
      psRatio:           stock.psRatio,
      evEbitda:          stock.evEbitda,
      pegRatio:          stock.pegRatio,
      roe:               stock.roe,
      sector:            stock.sector,
      industry:          stock.industry,
      news:              stock.news,
    });
    return {
      custom_id: stock.sym.replace(/\./g, '_'),
      params: {
        model:      'claude-sonnet-4-6',
        max_tokens: 1024,
        system,
        messages:   [{ role: 'user', content: user }],
      },
    };
  });

  // --- Step 4: Submit batch to Anthropic ---
  const batchRes = await fetch('https://api.anthropic.com/v1/messages/batches', {
    method: 'POST',
    headers: {
      'x-api-key':          anthropicKey,
      'anthropic-version':  '2023-06-01',
      'Content-Type':       'application/json',
    },
    body: JSON.stringify({ requests }),
  });

  if (!batchRes.ok) {
    const err = await batchRes.text();
    return res.setHeader('Content-Type', 'application/json').status(502).json({ error: `Anthropic batch error ${batchRes.status}: ${err.slice(0, 300)}` });
  }

  const batch = await batchRes.json();
  const batchId = batch.id;

  // --- Step 5: Persist batch ID + stock snapshot in Upstash Redis (6h TTL) ---
  // Strip news from the stored snapshot to keep the payload small.
  const stockSnapshot = enriched.map(({ news: _, ...rest }) => rest);
  await Promise.all([
    upstashSet('report:batch_id',    batchId,                          21600),
    upstashSet('report:stock_data',  JSON.stringify(stockSnapshot),    21600),
    upstashSet('report:submitted_at', new Date().toISOString(),        21600),
  ]);

  res.setHeader('Content-Type', 'application/json').status(200).json({
    ok: true,
    batchId,
    stocks: enriched.length,
    skipped: stocks.length - enriched.length,
    batchStatus: batch.processing_status,
    dailyExtra: stocks.length - STOCKS.length,
  });
}
