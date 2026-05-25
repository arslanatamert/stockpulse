export default async function handler(req, res) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) res.setHeader('Access-Control-Allow-Origin','*').setHeader('Content-Type','application/json').status(500).send(JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' })); return;

  const yh = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json', 'Referer': 'https://finance.yahoo.com/',
  };

  const stocks = [
    { sym: 'AIR.DE',  label: 'Airbus'          },
    { sym: 'DTE.DE',  label: 'Deutsche Telekom' },
    { sym: 'ALV.DE',  label: 'Allianz'          },
    { sym: 'RACE.MI', label: 'Ferrari'          },
    { sym: 'NTO.F',   label: 'Nintendo'         },
    { sym: '6RJ0.F',  label: 'Rocket Lab'       },
    { sym: '3ZU0.F',  label: 'AST SpaceMobile'  },
    { sym: '0YB0.F',  label: 'IonQ'             },
    { sym: 'A00.F',   label: 'Rigetti'          },
    { sym: 'RQ0.F',   label: 'D-Wave'           },
    { sym: 'QUBT',    label: 'QUBT'             },
    { sym: 'BTC-EUR',  label: 'Bitcoin'          },
    { sym: 'ETH-EUR',  label: 'Ethereum'         },
    { sym: 'SOL-EUR',  label: 'Solana'           },
    { sym: 'MATIC-EUR',label: 'Polygon'          },
  ];

  // Fetch all prices first
  const priceData = await Promise.all(stocks.map(async ({ sym, label }) => {
    try {
      const [r1d, r1y] = await Promise.all([
        fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${sym}?interval=5m&range=1d`, { headers: yh }),
        fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${sym}?interval=1wk&range=1y`, { headers: yh }),
      ]);
      const d1d = r1d.ok ? await r1d.json() : null;
      const d1y = r1y.ok ? await r1y.json() : null;
      const meta1d = d1d?.chart?.result?.[0]?.meta || {};
      const meta1y = d1y?.chart?.result?.[0]?.meta || {};
      const meta = meta1y.regularMarketPrice ? meta1y : meta1d;
      return {
        sym, label,
        price:     meta.regularMarketPrice,
        prevClose: meta1d.chartPreviousClose || meta1d.previousClose || null,
        high52:    meta.fiftyTwoWeekHigh,
        low52:     meta.fiftyTwoWeekLow,
        currency:  meta.currency || 'EUR',
      };
    } catch { return { sym, label, error: true }; }
  }));

  // Now analyse each with Claude — sequentially to avoid rate limits
  const results = [];
  for (const stock of priceData) {
    if (stock.error || !stock.price) {
      results.push({ label: stock.label, sym: stock.sym, status: 'NO_DATA' });
      continue;
    }
    const { price, prevClose, high52, low52, currency } = stock;
    const change   = prevClose ? ((price - prevClose) / prevClose * 100).toFixed(2) : null;
    const fromHigh = high52   ? ((price - high52)    / high52    * 100).toFixed(1)  : null;
    const fromLow  = low52    ? ((price - low52)     / low52     * 100).toFixed(1)  : null;
    const rangePos = high52 && low52 ? (((price - low52) / (high52 - low52)) * 100).toFixed(0) + '%' : 'N/A';

    const prompt = [
      'You are a senior equity analyst. Give a concise investment recommendation.',
      'Use your own knowledge of this company to supplement the data.',
      '',
      `Company: ${stock.label} (${stock.sym})`,
      `Price: ${currency} ${price}${change ? ' (' + change + '% today)' : ''}`,
      `52w High: ${high52 ? currency + ' ' + high52 + ' (' + fromHigh + '% from now)' : 'N/A'}`,
      `52w Low: ${low52 ? currency + ' ' + low52 + ' (' + fromLow + '% from now)' : 'N/A'}`,
      `52w Range Position: ${rangePos} (0%=at low, 100%=at high)`,
      '',
      'Respond ONLY with JSON, no markdown:',
      '{"recommendation":"BUY"|"HOLD"|"SELL","confidence":"Low"|"Medium"|"High","targetPrice":"string","summary":"1 sentence"}',
    ].join('\n');

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 256, messages: [{ role: 'user', content: prompt }] }),
      });
      const data = await res.json();
      const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
      const clean = text.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean.slice(clean.indexOf('{'), clean.lastIndexOf('}') + 1));
      results.push({ label: stock.label, sym: stock.sym, price: `${currency} ${price}`, ...parsed });
    } catch(e) {
      results.push({ label: stock.label, sym: stock.sym, status: 'ERROR', error: e.message });
    }
  }

  // Sort: SELL first, then HOLD, then BUY
  const order = { SELL: 0, HOLD: 1, BUY: 2 };
  results.sort((a, b) => (order[a.recommendation] ?? 3) - (order[b.recommendation] ?? 3));

  res.setHeader('Access-Control-Allow-Origin','*').setHeader('Content-Type','application/json').status(200).json({ asOf: new Date().toISOString(), results });
}
