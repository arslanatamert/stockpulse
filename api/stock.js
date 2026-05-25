export default async function handler(req, res) {
  const sym = (req.query.sym || '').toUpperCase().trim();
  if (!sym) res.setHeader('Access-Control-Allow-Origin','*').setHeader('Content-Type','application/json').status(400).send(JSON.stringify({ error: 'Missing sym parameter' })); return;

  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  const yh = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json', 'Referer': 'https://finance.yahoo.com/',
  };
  const rssH = { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/rss+xml,text/xml' };

  // Map known tickers to their German/EUR equivalent
  // US-listed stocks that are also on Frankfurt/XETRA
  // Verified Frankfurt tickers from Yahoo Finance (EUR-denominated)
  const eurAlternatives = {
    'RKLB':  '6RJ0.F',   // Rocket Lab
    'ASTS':  '3ZU0.F',   // AST SpaceMobile
    'IONQ':  '0YB0.F',   // IonQ
    'RGTI':  'A00.F',    // Rigetti Computing
    'QUBT':  'QUBT',     // NASDAQ only, no Frankfurt listing
    'META':  'FB2A.DE',
    'AAPL':  'APC.F',
    'AMZN':  'AMZ.F',
    'MSFT':  'MSF.F',
    'NVDA':  'NVD.F',
    'TSLA':  'TL0.F',
    'RACE':  'RACE.MI',  // Ferrari Milan
  };

  // If a USD ticker was passed, try to use its EUR Frankfurt equivalent
  const originalSym = sym;

  // Detect crypto: Yahoo crypto tickers use format COIN-CURRENCY e.g. BTC-EUR, ETH-USD
  const isCrypto = /^[A-Z0-9]+-[A-Z]{3}$/.test(sym) ||
    ['BTC','ETH','SOL','ADA','TRX','MATIC','XRP','BNB','DOGE','DOT','AVAX','LINK'].includes(sym);

  // For bare crypto like BTC, auto-append -EUR
  function resolveCrypto(ticker) {
    if (ticker.includes('-')) return ticker; // already has currency
    const cryptoNames = ['BTC','ETH','SOL','ADA','TRX','MATIC','XRP','BNB','DOGE','DOT','AVAX','LINK','UNI','ATOM','LTC','BCH','FIL','ICP','HBAR','VET'];
    if (cryptoNames.includes(ticker)) return ticker + '-EUR';
    return null;
  }

  // Smart suffix resolution for stocks
  async function resolveTickerSuffix(ticker) {
    if (ticker.includes('.') || eurAlternatives[ticker]) return eurAlternatives[ticker] || ticker;
    // Try .DE (XETRA) first, then .F (Frankfurt), then bare (US/international)
    for (const suffix of ['.DE', '.F', '']) {
      const candidate = ticker + suffix;
      try {
        const res = await fetch(
          `https://query2.finance.yahoo.com/v8/finance/chart/${candidate}?interval=1d&range=1d`,
          { headers: yh }
        );
        if (res.ok) {
          const data = await res.json();
          if (data.chart?.result?.[0]?.meta?.regularMarketPrice) return candidate;
        }
      } catch {}
    }
    return ticker;
  }

  const cryptoResolved = resolveCrypto(sym);
  const resolvedSym = cryptoResolved || eurAlternatives[sym] || await resolveTickerSuffix(sym);
  const isActuallyCrypto = isCrypto || cryptoResolved !== null || resolvedSym.includes('-EUR') || resolvedSym.includes('-USD');

  function coreKeywords(name, ticker) {
    // For crypto (e.g. TRX-EUR, BTC-EUR) build keywords from the canonical coin name
    if (ticker.includes('-') && /^[A-Z]+-(EUR|USD|USDT|GBP)$/.test(ticker)) {
      const coinTicker = ticker.split('-')[0].toLowerCase();
      const entry = (CRYPTO_NAMES[coinTicker.toUpperCase()] || coinTicker).toLowerCase();
      // Split multi-word entries: "polygon pol" → ["polygon","pol"], "xrp ripple" → ["xrp","ripple"]
      const extraKws = entry.split(/\s+/).filter(w => w.length > 1);
      return [...new Set([...extraKws, coinTicker])];
    }
    const cleaned = name
      .replace(/\b(co\.?|ltd\.?|inc\.?|corp\.?|ag|se|plc|gmbh|n\.v\.?|s\.a\.?|llc|nv|sa|usd|eur|gbp|[a-c]\b|r\b)\b/gi, ' ')
      .replace(/[^a-zA-Z0-9\s]/g, ' ').replace(/\s{2,}/g, ' ').trim().toLowerCase();
    const words = cleaned.split(/\s+/).filter(w => w.length > 2);
    const base = ticker.split(/[.\-]/)[0].toLowerCase();
    if (!words.includes(base)) words.push(base);
    return [...new Set(words)];
  }

  function parseRss(text, label) {
    return [...text.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 15).map(m => {
      const b = m[1];
      const get = t => { const x = b.match(new RegExp(`<${t}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${t}>|<${t}[^>]*>([\\s\\S]*?)<\\/${t}>`)); return x ? (x[1]||x[2]||'').trim() : ''; };
      return { title: get('title'), link: get('link')||get('guid'), source: label, pubDate: get('pubDate'), description: get('description').replace(/<[^>]+>/g,'').slice(0,160) };
    }).filter(i => i.title);
  }

  // FMP ticker map: Yahoo Frankfurt/XETRA tickers → FMP-recognized symbols
  const fmpTickerMap = {
    'AIR.DE': 'EADSY',  // Airbus
    'DTE.DE': 'DTEGY',  // Deutsche Telekom
    'ALV.DE': 'ALIZY',  // Allianz
    'NTO.F':  'NTDOY',  // Nintendo
    'RQ0.F':  'QBTS',   // D-Wave (QBTS on NYSE)
    '6RJ0.F': 'RKLB',   // Rocket Lab
    '3ZU0.F': 'ASTS',   // AST SpaceMobile
    '0YB0.F': 'IONQ',   // IonQ
    'A00.F':  'RGTI',   // Rigetti
    'RACE.MI':'RACE',   // Ferrari
  };

  async function fetchFmpFundamentals(sym, originalSym) {
    const key = process.env.FMP_API_KEY;
    if (!key) return {};
    // Try mapped ticker first, then original sym, then base
    const cleanSym = fmpTickerMap[sym] || fmpTickerMap[originalSym] || (originalSym || sym).split('.')[0];
    try {
      // profile = free, gives marketCap, description, sector, dividendYield
      // key-metrics-ttm = free, gives peRatioTTM, volumeAvgTTM
      const [profileRes, metricsRes] = await Promise.all([
        fetch(`https://financialmodelingprep.com/stable/profile?symbol=${cleanSym}&apikey=${key}`),
        fetch(`https://financialmodelingprep.com/stable/key-metrics-ttm?symbol=${cleanSym}&apikey=${key}`),
      ]);
      const profileArr = profileRes.ok ? await profileRes.json() : [];
      const metricsArr = metricsRes.ok ? await metricsRes.json() : [];
      const p = Array.isArray(profileArr) ? profileArr[0] : profileArr;
      const m = Array.isArray(metricsArr) ? metricsArr[0] : metricsArr;
      if (!p && !m) return {};
      return {
        marketCap:     p?.marketCap   || p?.mktCap                        || null,
        pe:            m?.peRatioTTM  || m?.priceEarningsRatioTTM         || null,
        eps:           m?.epsTTM      || m?.netIncomePerShareTTM          || null,
        avgVolume:     m?.volumeAvgTTM || m?.averageInventoryTTM          || null,
        dividendYield: p?.dividendYield || (p?.lastDiv && p?.price ? p.lastDiv / p.price : null) || null,
        description:   p?.description || '',
        sector:        p?.sector      || '',
        industry:      p?.industry    || '',
      };
    } catch { return {}; }
  }

  // Canonical crypto names for news queries — strip exchange/currency suffix
  const CRYPTO_NAMES = {
    'BTC': 'Bitcoin', 'ETH': 'Ethereum', 'SOL': 'Solana', 'ADA': 'Cardano',
    'TRX': 'TRON', 'MATIC': 'Polygon POL', 'POL': 'Polygon POL', 'XRP': 'XRP Ripple',
    'BNB': 'BNB', 'DOGE': 'Dogecoin', 'DOT': 'Polkadot', 'AVAX': 'Avalanche',
    'LINK': 'Chainlink', 'UNI': 'Uniswap', 'ATOM': 'Cosmos', 'LTC': 'Litecoin',
    'BCH': 'Bitcoin Cash',
  };

  function newsSearchPhrase(companyName, sym, isCrypto) {
    if (isCrypto) {
      // Extract coin ticker from e.g. BTC-EUR or bare BTC
      const coinTicker = sym.split('-')[0];
      return CRYPTO_NAMES[coinTicker] || coinTicker;
    }
    // For stocks: take up to first 2 words, skip pure currency/suffix words
    return companyName.split(' ')
      .filter(w => !['EUR','USD','GBP','JPY','CHF','Inc','Corp','Ltd','AG','SE','PLC'].includes(w))
      .slice(0, 2).join(' ');
  }

  async function fetchNewsApi(companyName, keywords, isCrypto) {
    const key = process.env.NEWS_API_KEY;
    if (!key) return [];
    try {
      const phrase = newsSearchPhrase(companyName, sym, isCrypto);
      const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent('"'+phrase+'"')}&language=en&sortBy=publishedAt&pageSize=10&apiKey=${key}`;
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.articles || [])
        .filter(a => a.title && !a.title.includes('[Removed]') && keywords.some(kw => (a.title+' '+(a.description||'')).toLowerCase().includes(kw)))
        .slice(0, 6)
        .map(a => ({ title: a.title, link: a.url, source: a.source?.name || 'News', pubDate: a.publishedAt, description: (a.description||'').slice(0,160) }));
    } catch { return []; }
  }

  async function fetchGoogleNews(companyName, keywords, isCrypto) {
    // Google News RSS blocks cloud IPs — skip and return empty
    return [];
  }

  try {
    // Fetch all chart ranges in parallel
    // Use interval=1d&range=5d as primary for accurate prevClose (yesterday's close)
    const [chart1dRes, chart1wRes, chart1mRes, chart3mRes, chart6mRes, chart1yRes, chart2dRes] = await Promise.all([
      fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${resolvedSym}?interval=5m&range=1d`,   { headers: yh }),
      fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${resolvedSym}?interval=30m&range=5d`,  { headers: yh }),
      fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${resolvedSym}?interval=1d&range=1mo`,  { headers: yh }),
      fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${resolvedSym}?interval=1d&range=3mo`,  { headers: yh }),
      fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${resolvedSym}?interval=1d&range=6mo`,  { headers: yh }),
      fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${resolvedSym}?interval=1d&range=1y`,   { headers: yh }),
      fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${resolvedSym}?interval=1d&range=5d`,   { headers: yh }),
    ]);

    const primary = chart1yRes.ok ? chart1yRes : chart1dRes;
    if (!primary.ok) res.setHeader('Access-Control-Allow-Origin','*').setHeader('Content-Type','application/json').status(404).send(JSON.stringify({ error: `Ticker "${sym}" not found.` })); return;

    const parse = async (res) => {
      if (!res.ok) return null;
      try {
        const d = await res.json();
        const r = d.chart?.result?.[0];
        if (!r) return null;
        const ts = r.timestamp || [];
        const cl = r.indicators?.quote?.[0]?.close || [];
        return { meta: r.meta, points: ts.map((t,i) => ({ t: t*1000, v: cl[i] })).filter(p => p.v != null) };
      } catch { return null; }
    };

    const [d1, d1w, d1m, d3m, d6m, d1y, d2d] = await Promise.all([
      parse(chart1dRes), parse(chart1wRes), parse(chart1mRes),
      parse(chart3mRes), parse(chart6mRes), parse(chart1yRes), parse(chart2dRes),
    ]);
    const main = d1y || d6m || d3m || d1m || d1w || d1;
    if (!main) res.setHeader('Access-Control-Allow-Origin','*').setHeader('Content-Type','application/json').status(404).send(JSON.stringify({ error: `Keine Daten für "${sym}".` })); return;

    const meta        = main.meta;
    const price       = meta.regularMarketPrice;

    // Guard: if no price came back, the ticker exists on Yahoo but has no live data
    if (!price) {
      res.setHeader('Access-Control-Allow-Origin','*').setHeader('Content-Type','application/json').status(404).send(JSON.stringify({
        error: `No price data for "${resolvedSym}". The stock may be delisted, suspended, or not trading.`
      })); return;
    }

    // CRITICAL: use 1d intraday chart for prevClose — the 1y weekly chart's
    // chartPreviousClose is last week's close, not yesterday's.
    const prevClose   = d1?.meta?.chartPreviousClose
                     || d2d?.meta?.chartPreviousClose
                     || d1?.meta?.previousClose
                     || d2d?.meta?.previousClose
                     || meta.regularMarketPreviousClose
                     || null;
    const high52      = meta.fiftyTwoWeekHigh || null;
    const low52       = meta.fiftyTwoWeekLow  || null;
    const currency    = meta.currency || 'EUR';
    const companyName = meta.longName || meta.shortName || resolvedSym;
    const exchange    = meta.fullExchangeName || meta.exchangeName || '';
    const keywords    = coreKeywords(companyName, sym);

    const [yahooRssRes, newsApiArticles, hbNews, fmp] = await Promise.all([
      fetch(`https://feeds.finance.yahoo.com/rss/2.0/headline?s=${resolvedSym}&region=US&lang=en-US`, { headers: yh }),
      fetchNewsApi(companyName, keywords, isActuallyCrypto),
      fetchGoogleNews(companyName, keywords, isActuallyCrypto),
      isActuallyCrypto ? Promise.resolve({}) : fetchFmpFundamentals(resolvedSym, originalSym),
    ]);

    let yahooNews = [];
    try {
      const allYahoo = parseRss(await yahooRssRes.text(), 'Yahoo Finance');
      // Filter to articles actually mentioning the company — Yahoo RSS can return general market news
      yahooNews = allYahoo.filter(i =>
        keywords.some(kw => (i.title + ' ' + (i.description || '')).toLowerCase().includes(kw))
      );
      // If strict filter kills everything, fall back to unfiltered (ticker-specific feed is usually on-topic)
      if (yahooNews.length === 0) yahooNews = allYahoo;
    } catch {}

    // Merge and sort ALL news by date, newest first
    // Sentiment scoring based on title + description keywords
    function scoreSentiment(item) {
      // Score title only — descriptions contain historical context that skews scoring
      // e.g. "losses" in a description about past bear cycles shouldn't make a bullish article negative
      const title = (item.title || '').toLowerCase();
      const positive = ['beat','beats','record','surge','surges','soars','jumps','rally','rallies','profit','profits','growth','grows','upgrade','upgraded','buy','strong','outperform','gains','gain','rises','rise','bullish','breakthrough','launch','launches','wins','win','deal','partnership','expands','expansion','milestone','revenue','exceeds','exceeded','positive','optimistic','all-time high','ath','buyback','worth','invested','halving','best','top','leads'];
      const negative = ['miss','misses','falls','drops','drop','decline','declines','loss','losses','cut','cuts','downgrade','downgraded','sell','weak','underperform','warning','warns','concern','concerns','bearish','lawsuit','fine','fined','recall','recalls','layoff','layoffs','bankruptcy','debt','crisis','crash','crashes','plunges','slumps','disappoints','disappointing','negative','pessimistic','halts','suspended','probe','investigation'];
      let score = 0;
      positive.forEach(w => { if (title.includes(w)) score++; });
      negative.forEach(w => { if (title.includes(w)) score--; });
      if (score > 0) return 'positive';
      if (score < 0) return 'negative';
      return 'mixed';
    }

    const now = Date.now();
    const seen = new Set();
    const allNews = [...hbNews, ...newsApiArticles, ...yahooNews]
      .filter(item => {
        if (!item.title || seen.has(item.title)) return false;
        seen.add(item.title); return true;
      })
      .sort((a, b) => {
        const da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
        const db = b.pubDate ? new Date(b.pubDate).getTime() : 0;
        return db - da;
      })
      .map(item => {
        const pubTime = item.pubDate ? new Date(item.pubDate).getTime() : 0;
        return {
          ...item,
          sentiment: scoreSentiment(item),
          isRecent: pubTime > 0 && (now - pubTime) < 24 * 60 * 60 * 1000,
        };
      })
      .slice(0, 10);

    res.setHeader('Access-Control-Allow-Origin','*').setHeader('Content-Type','application/json').status(200).json({
        symbol: resolvedSym, originalSymbol: originalSym, name: companyName, exchange, currency,
        price, prevClose, high52, low52,
        dayHigh: meta.regularMarketDayHigh || null,
        dayLow:  meta.regularMarketDayLow  || null,
        volume:  meta.regularMarketVolume  || null,
        marketCap:     fmp.marketCap     || null,
        pe:            fmp.pe            || null,
        avgVolume:     fmp.avgVolume     || null,
        dividendYield: fmp.dividendYield || null,
        description:   fmp.description  || '',
        sector:        fmp.sector        || '',
        // Chart data for each range
        chart1d:  d1  ? d1.points  : [],
        chart1w:  d1w ? d1w.points : [],
        chart1m:  d1m ? d1m.points : [],
        chart3m:  d3m ? d3m.points : [],
        chart6m:  d6m ? d6m.points : [],
        chart1y:  d1y ? d1y.points : [],
        news: allNews,
      });
  } catch (err) {
    res.setHeader('Access-Control-Allow-Origin','*').setHeader('Content-Type','application/json').status(500).json({ error: 'Server error: ' + err.message });
  }
}
