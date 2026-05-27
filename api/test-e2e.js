export default async function handler(req, res) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  const results = [];
  const t0 = Date.now();

  function pass(name, detail) { results.push({ name, status: 'PASS', detail }); }
  function fail(name, detail) { results.push({ name, status: 'FAIL', detail }); }
  function warn(name, detail) { results.push({ name, status: 'WARN', detail }); }

  const yh = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json', 'Referer': 'https://finance.yahoo.com/',
  };

  // ── 1. ENVIRONMENT VARIABLES ────────────────────────────────────────────────
  const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
  const hasFmpKey       = !!process.env.FMP_API_KEY;
  const hasNewsApiKey   = !!process.env.NEWS_API_KEY;
  hasAnthropicKey ? pass('ENV: ANTHROPIC_API_KEY', 'set') : fail('ENV: ANTHROPIC_API_KEY', 'NOT SET — AI analysis will fail');
  hasFmpKey       ? pass('ENV: FMP_API_KEY',       'set') : warn('ENV: FMP_API_KEY',       'NOT SET — fundamentals will show dashes');
  hasNewsApiKey   ? pass('ENV: NEWS_API_KEY',       'set') : warn('ENV: NEWS_API_KEY',       'NOT SET — news limited to Yahoo RSS');

  // ── 2. YAHOO FINANCE CHART API ──────────────────────────────────────────────
  const chartTests = [
    // Stocks
    { sym: 'AIR.DE',   label: 'Airbus',          expectCurrency: 'EUR' },
    { sym: 'DTE.DE',   label: 'Deutsche Telekom', expectCurrency: 'EUR' },
    { sym: 'ALV.DE',   label: 'Allianz',          expectCurrency: 'EUR' },
    { sym: 'RACE.MI',  label: 'Ferrari',          expectCurrency: 'EUR' },
    { sym: 'NTO.F',    label: 'Nintendo',         expectCurrency: 'EUR' },
    { sym: '6RJ0.F',   label: 'Rocket Lab',       expectCurrency: 'EUR' },
    { sym: '3ZU0.F',   label: 'AST SpaceMobile',  expectCurrency: 'EUR' },
    { sym: '0YB0.F',   label: 'IonQ',             expectCurrency: 'EUR' },
    { sym: 'A00.F',    label: 'Rigetti',          expectCurrency: 'EUR' },
    { sym: 'RQ0.F',    label: 'D-Wave',           expectCurrency: 'EUR' },
    { sym: 'QUBT',     label: 'QUBT',             expectCurrency: 'USD' },
    // Crypto
    { sym: 'BTC-EUR',   label: 'Bitcoin',   expectCurrency: 'EUR', isCrypto: true },
    { sym: 'ETH-EUR',   label: 'Ethereum',  expectCurrency: 'EUR', isCrypto: true },
    { sym: 'SOL-EUR',   label: 'Solana',    expectCurrency: 'EUR', isCrypto: true },
    { sym: 'ADA-EUR',   label: 'Cardano',   expectCurrency: 'EUR', isCrypto: true },
    { sym: 'TRX-EUR',   label: 'TRON',      expectCurrency: 'EUR', isCrypto: true },
    { sym: 'MATIC-EUR', label: 'Polygon',   expectCurrency: 'EUR', isCrypto: true },
  ];

  const chartResults = await Promise.all(chartTests.map(async ({ sym, label, expectCurrency, isCrypto }) => {
    try {
      const ranges = [
        { interval: '5m',  range: '1d'  },
        { interval: '30m', range: '5d'  },
        { interval: '1d',  range: '1mo' },
        { interval: '1d',  range: '3mo' },
        { interval: '1d',  range: '6mo' },
        { interval: '1d',  range: '1y'  },
      ];
      const responses = await Promise.all(
        ranges.map(r => fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${sym}?interval=${r.interval}&range=${r.range}`, { headers: yh }))
      );
      const datas = await Promise.all(responses.map(r => r.ok ? r.json() : null));

      const meta1d = datas[0]?.chart?.result?.[0]?.meta || {};
      const meta1y = datas[5]?.chart?.result?.[0]?.meta || {};
      const meta = meta1y.regularMarketPrice ? meta1y : meta1d;

      const price     = meta.regularMarketPrice;
      const prevClose = meta1d.chartPreviousClose || meta1d.previousClose;
      const currency  = meta.currency;

      // Point counts per range — critical for MA rendering
      const ptCounts = datas.map((d, i) => {
        const closes = d?.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.filter(v => v != null) || [];
        return { range: ranges[i].range, pts: closes.length };
      });

      const issues = [];
      if (!price)     issues.push('no price');
      if (!prevClose) issues.push('no prevClose → daily change broken');
      if (currency !== expectCurrency) issues.push(`currency ${currency} ≠ expected ${expectCurrency}`);

      // MA viability: warn if not enough points for the MAs used per range
      const r1y = ptCounts.find(p => p.range === '1y');
      const r1m = ptCounts.find(p => p.range === '1mo');
      const r1d = ptCounts.find(p => p.range === '1d');
      if (r1y && r1y.pts < 50)  issues.push(`1Y only ${r1y.pts} pts — MA50 won't render`);
      if (r1m && r1m.pts < 7)   issues.push(`1M only ${r1m.pts} pts — MA7 won't render`);
      if (r1d && r1d.pts < 9)   issues.push(`1D only ${r1d.pts} pts — MA9 won't render`);

      const ptSummary = ptCounts.map(p => `${p.range}:${p.pts}pts`).join(' | ');

      if (issues.length === 0) {
        return { sym, label, status: 'PASS', detail: `${currency} ${price} | ${ptSummary}` };
      } else {
        return { sym, label, status: 'FAIL', detail: issues.join('; ') + ' | ' + ptSummary };
      }
    } catch (e) {
      return { sym, label, status: 'FAIL', detail: e.message };
    }
  }));

  chartResults.forEach(r => results.push({ name: `Chart: ${r.label} (${r.sym})`, status: r.status, detail: r.detail }));

  // ── 3. SEARCH AUTOCOMPLETE ──────────────────────────────────────────────────
  try {
    const searchRes = await fetch('https://query2.finance.yahoo.com/v1/finance/search?q=Porsche&lang=en-US&region=DE&quotesCount=5&newsCount=0', { headers: yh });
    if (!searchRes.ok) throw new Error(`HTTP ${searchRes.status}`);
    const searchData = await searchRes.json();
    const quotes = searchData.quotes || [];
    const hasPorsche = quotes.some(q => q.symbol === 'P911.DE' || (q.longname || q.shortname || '').toLowerCase().includes('porsche'));
    hasPorsche
      ? pass('Search: "Porsche" autocomplete', `${quotes.length} results, Porsche found`)
      : warn('Search: "Porsche" autocomplete', `${quotes.length} results but Porsche AG not in top results`);
  } catch(e) { fail('Search: autocomplete', e.message); }

  // ── 4. TICKER RESOLUTION — bare tickers ────────────────────────────────────
  const bareTests = [
    { bare: 'MUV2', expectResolved: 'MUV2.DE' },
    { bare: 'BTC',  expectResolved: 'BTC-EUR'  },
    { bare: 'BMW',  expectResolved: 'BMW.DE'   },
  ];
  for (const { bare, expectResolved } of bareTests) {
    try {
      const res = await fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${expectResolved}?interval=1d&range=1d`, { headers: yh });
      const data = res.ok ? await res.json() : null;
      const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
      price
        ? pass(`Ticker resolution: ${bare} → ${expectResolved}`, `price: ${price}`)
        : fail(`Ticker resolution: ${bare} → ${expectResolved}`, 'no price returned');
    } catch(e) { fail(`Ticker resolution: ${bare}`, e.message); }
  }

  // ── 5. FMP FUNDAMENTALS ─────────────────────────────────────────────────────
  if (hasFmpKey) {
    const fmpTests = [
      { fmp: 'EADSY', label: 'Airbus'   },
      { fmp: 'DTEGY', label: 'Telekom'  },
      { fmp: 'RKLB',  label: 'Rocket Lab' },
      { fmp: 'RACE',  label: 'Ferrari'  },
      { fmp: 'NTDOY', label: 'Nintendo' },
    ];
    for (const { fmp, label } of fmpTests) {
      try {
        const [pRes, mRes] = await Promise.all([
          fetch(`https://financialmodelingprep.com/stable/profile?symbol=${fmp}&apikey=${process.env.FMP_API_KEY}`),
          fetch(`https://financialmodelingprep.com/stable/key-metrics-ttm?symbol=${fmp}&apikey=${process.env.FMP_API_KEY}`),
        ]);
        const p = (pRes.ok ? await pRes.json() : [])?.[0];
        const m = (mRes.ok ? await mRes.json() : [])?.[0];
        const marketCap = p?.marketCap;
        const pe        = m?.peRatioTTM;
        marketCap
          ? pass(`FMP: ${label} market cap`, `$${(marketCap/1e9).toFixed(1)}B${pe ? ` | P/E: ${pe.toFixed(1)}` : ''}`)
          : fail(`FMP: ${label} market cap`, `profile: ${pRes.status}, metrics: ${mRes.status}`);
      } catch(e) { fail(`FMP: ${label}`, e.message); }
    }
  } else {
    warn('FMP: fundamentals', 'FMP_API_KEY not set — skipped');
  }

  // ── 6. AI ANALYSIS — full end-to-end with real Telekom payload ─────────────
  if (hasAnthropicKey) {
    // 6a. Quick connectivity ping (cheap — no real prompt)
    try {
      const pingRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 20, messages: [{ role: 'user', content: 'Reply with exactly: {"ok":true}' }] })
      });
      if (!pingRes.ok) throw new Error(`HTTP ${pingRes.status}: ${await pingRes.text()}`);
      const pd = await pingRes.json();
      const pt = pd.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '';
      JSON.parse(pt.trim());
      pass('AI: Anthropic connectivity', `claude-sonnet-4-6 reachable`);
    } catch(e) { fail('AI: Anthropic connectivity', e.message); }

    // 6b. Full valuation schema test with realistic Telekom data
    try {
      // Mirror the exact prompt logic from analyze.js
      const cs = 'EUR';
      const price = 28.50, prevClose = 28.20, high52 = 30.10, low52 = 20.15;
      const pe = 14.2, eps = 2.01, bvps = 16.50, pbRatio = 1.73, psRatio = 0.92;
      const evEbitda = 6.8, pegRatio = 1.1, roe = 0.122;
      const graham = Math.sqrt(22.5 * eps * bvps).toFixed(2);
      const schema = `{"recommendation":"BUY","confidence":"High","fmv":"${cs} 0.00","fmvVerdict":"Undervalued","fmvUpside":0.0,"valuationMetrics":[{"method":"P/E vs Sector","value":"0x","context":"sector 0x","signal":"Fair"},{"method":"PEG Ratio","value":"0.0","context":"<1=cheap","signal":"Fair"},{"method":"Graham Number","value":"${cs} 0","context":"√22.5×EPS×BVPS","signal":"Fair"},{"method":"DCF Estimate","value":"${cs} 0","context":"0%WACC 0%g","signal":"Fair"},{"method":"Price / Book","value":"0x","context":"ROE 0%","signal":"Fair"},{"method":"Price / Sales","value":"0x","context":"sector 0x","signal":"Fair"},{"method":"EV / EBITDA","value":"0x","context":"sector 0x","signal":"Fair"}],"valuation":"1 sentence.","fundamental":"1 sentence.","sentiment":"1 sentence.","risks":["r1","r2","r3"],"summary":"1 sentence."}`;

      const prompt = [
        'You are a senior equity analyst. Deliver a rigorous multi-method valuation and investment recommendation.',
        'Use your knowledge of this company, sector, and peers to fill in any N/A fields.',
        '', '## Market Data',
        `Company : Deutsche Telekom AG (DTE.DE)`,
        `Sector  : Communication Services | Industry: Telecom Services`,
        `Price   : ${cs} ${price} (${((price-prevClose)/prevClose*100).toFixed(2)}% today)`,
        `52w High: ${cs} ${high52} (${((price-high52)/high52*100).toFixed(1)}% from now)`,
        `52w Low : ${cs} ${low52} (+${((price-low52)/low52*100).toFixed(1)}% from now)`,
        `Mkt Cap : 132.0B ${cs} | Avg Vol: 12.0M`,
        `Dividend: 3.60%`,
        '', '## Valuation Inputs (estimate with your knowledge where N/A)',
        `P/E: ${pe} | EPS: ${cs} ${eps} | BVPS: ${cs} ${bvps} | Graham: ${cs} ${graham}`,
        `PEG: ${pegRatio} | P/B: ${pbRatio}x | P/S: ${psRatio}x | EV/EBITDA: ${evEbitda}x | ROE: ${(roe*100).toFixed(1)}%`,
        '', '## Recent News',
        '1. [Reuters] Deutsche Telekom raises 2025 guidance on T-Mobile US strength',
        '2. [Bloomberg] Telekom fiber rollout accelerates across Germany',
        '3. [Yahoo Finance] DTE dividend confirmed, yield remains above 3.5%',
        '', '## Output — respond ONLY with compact single-line JSON (no whitespace, no newlines, no indentation):',
        `- fmv: weighted avg of DCF + Graham + sector P/E target, formatted as "${cs} 0.00"`,
        '- fmvUpside: (fmv − price) / price × 100',
        '- fmvVerdict: "Undervalued" >10%, "Overvalued" <−10%, else "Fairly Valued"',
        '- signal: exactly "Undervalued", "Fair", "Overvalued", or "N/A"',
        '- valuation / fundamental / sentiment: MAX 1 concise sentence each',
        '- recommendation (BUY/HOLD/SELL) derived from all 4 sections combined',
        '- IMPORTANT: output must be a single line of JSON with no whitespace between tokens',
        '', schema,
      ].join('\n');

      const t1 = Date.now();
      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 800, messages: [{ role: 'user', content: prompt }] })
      });
      if (!aiRes.ok) throw new Error(`HTTP ${aiRes.status}: ${(await aiRes.text()).slice(0,200)}`);
      const aiData = await aiRes.json();
      const elapsed = Date.now() - t1;

      const rawText = aiData.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '';
      const clean = rawText.replace(/^```(?:json)?\s*/i,'').replace(/\s*```\s*$/i,'').trim();
      const parsed = JSON.parse(clean.slice(clean.indexOf('{'), clean.lastIndexOf('}')+1));

      // Token usage + cost
      const inTok  = aiData.usage?.input_tokens  || 0;
      const outTok = aiData.usage?.output_tokens || 0;
      const costCents = ((inTok * 3 + outTok * 15) / 1_000_000 * 100).toFixed(2);

      // Validate schema
      const requiredTop = ['recommendation','confidence','fmv','fmvVerdict','fmvUpside','valuationMetrics','valuation','fundamental','sentiment','risks','summary'];
      const missingTop  = requiredTop.filter(f => !(f in parsed));
      const metrics     = Array.isArray(parsed.valuationMetrics) ? parsed.valuationMetrics : [];
      const metricFields = ['method','value','context','signal'];
      const badMetrics  = metrics.filter(m => metricFields.some(f => !(f in m)));

      if (missingTop.length > 0) {
        fail('AI: Valuation schema — top-level fields', `missing: ${missingTop.join(', ')}`);
      } else if (metrics.length !== 7) {
        fail('AI: Valuation schema — metrics count', `expected 7, got ${metrics.length} | truncation likely`);
      } else if (badMetrics.length > 0) {
        fail('AI: Valuation schema — metric structure', `${badMetrics.length} metric(s) missing fields`);
      } else {
        pass('AI: Valuation schema — full structure', [
          `rec:${parsed.recommendation} conf:${parsed.confidence}`,
          `fmv:${parsed.fmv} verdict:${parsed.fmvVerdict} upside:${parsed.fmvUpside}%`,
          `metrics:${metrics.length}/7 ✓`,
          `tokens in:${inTok} out:${outTok} → ~${costCents}¢`,
          `${elapsed}ms`,
        ].join(' | '));
      }

      // Warn if cost is drifting over 1.5¢
      const costNum = parseFloat(costCents);
      if (costNum > 1.5) warn('AI: Cost check', `${costCents}¢ — over 1.5¢ target (in:${inTok} out:${outTok})`);
      else pass('AI: Cost check', `${costCents}¢ per call (in:${inTok} out:${outTok})`);

    } catch(e) { fail('AI: Valuation schema test', e.message); }
  } else {
    fail('AI: Anthropic API', 'ANTHROPIC_API_KEY not set');
  }

  // ── 7. NEWS API ─────────────────────────────────────────────────────────────
  if (hasNewsApiKey) {
    try {
      const newsRes = await fetch(`https://newsapi.org/v2/everything?q="Airbus"&language=en&sortBy=publishedAt&pageSize=3&apiKey=${process.env.NEWS_API_KEY}`);
      if (!newsRes.ok) throw new Error(`HTTP ${newsRes.status}`);
      const newsData = await newsRes.json();
      const count = newsData.articles?.length || 0;
      count > 0
        ? pass('NewsAPI: search', `${count} articles for "Airbus"`)
        : warn('NewsAPI: search', 'no articles returned');
    } catch(e) { fail('NewsAPI: search', e.message); }
  } else {
    warn('NewsAPI', 'NEWS_API_KEY not set — skipped');
  }

  // ── 8. SENTIMENT SCORING ────────────────────────────────────────────────────
  const sentTests = [
    { title: 'Airbus beats Q1 earnings, record profits surge', expected: 'positive' },
    { title: 'Tesla drops 15% on missing revenue targets, loss widens', expected: 'negative' },
    { title: 'Nintendo announces new console for 2026', expected: 'mixed' },
  ];
  sentTests.forEach(({ title, expected }) => {
    const text = title.toLowerCase();
    const pos = ['beat','beats','record','surge','surges','profit','profits','growth','upgrade','strong','gains','rise','bullish','breakthrough','win','deal','expands','milestone','exceeds','optimistic'];
    const neg = ['miss','misses','drops','drop','decline','loss','losses','cut','downgrade','warn','concern','bearish','lawsuit','fine','recall','layoff','bankruptcy','debt','crash','plunge','slump','disappoints','negative'];
    let score = 0;
    pos.forEach(w => { if (text.includes(w)) score++; });
    neg.forEach(w => { if (text.includes(w)) score--; });
    const result = score > 0 ? 'positive' : score < 0 ? 'negative' : 'mixed';
    result === expected
      ? pass(`Sentiment: "${title.slice(0,40)}…"`, `correctly scored as ${result}`)
      : fail(`Sentiment: "${title.slice(0,40)}…"`, `scored ${result}, expected ${expected}`);
  });

  // ── SUMMARY ─────────────────────────────────────────────────────────────────
  const summary = {
    total:   results.length,
    pass:    results.filter(r => r.status === 'PASS').length,
    warn:    results.filter(r => r.status === 'WARN').length,
    fail:    results.filter(r => r.status === 'FAIL').length,
    elapsed: ((Date.now() - t0) / 1000).toFixed(1) + 's',
  };

  res.setHeader('Access-Control-Allow-Origin','*').setHeader('Content-Type','application/json').status(200).send(JSON.stringify({ summary, results }, null, 2)); return;
};
