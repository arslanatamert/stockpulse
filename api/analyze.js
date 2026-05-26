export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*').status(200).send(''); return;
  }
  if (req.method !== 'POST') {
    res.setHeader('Access-Control-Allow-Origin', '*').setHeader('Content-Type', 'application/json')
      .status(405).json({ error: 'Method Not Allowed' }); return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.setHeader('Access-Control-Allow-Origin', '*').setHeader('Content-Type', 'application/json')
      .status(500).json({ error: 'ANTHROPIC_API_KEY not configured' }); return;
  }

  // Vercel auto-parses JSON bodies — handle both pre-parsed object and raw string
  let body;
  if (req.body && typeof req.body === 'object') {
    body = req.body;
  } else if (typeof req.body === 'string') {
    try { body = JSON.parse(req.body); }
    catch { res.setHeader('Access-Control-Allow-Origin', '*').setHeader('Content-Type', 'application/json')
      .status(400).json({ error: 'Invalid JSON body' }); return; }
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*').setHeader('Content-Type', 'application/json')
      .status(400).json({ error: 'Missing request body' }); return;
  }

  const {
    name, symbol, currency, price, prevClose, high52, low52,
    pe, marketCap, avgVolume, dividendYield,
    eps, bookValuePerShare, pbRatio, psRatio, evEbitda, pegRatio, roe,
    sector, industry, news,
  } = body;

  if (!name || !price) {
    res.setHeader('Access-Control-Allow-Origin', '*').setHeader('Content-Type', 'application/json')
      .status(400).json({ error: 'Missing required fields: name, price' }); return;
  }

  const cs = currency || 'EUR';
  const change   = price && prevClose ? ((price - prevClose) / prevClose * 100).toFixed(2) : null;
  const fromHigh = high52 ? ((price - high52) / high52 * 100).toFixed(1) : null;
  const fromLow  = low52  ? ((price - low52)  / low52  * 100).toFixed(1) : null;

  function fmtNum(n, suf) {
    if (!n && n !== 0) return 'N/A';
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B' + (suf || '');
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M' + (suf || '');
    return n + (suf || '');
  }
  function f2(n) { return n != null ? Number(n).toFixed(2) : 'N/A'; }
  function f1(n) { return n != null ? Number(n).toFixed(1) : 'N/A'; }

  // Pre-calculate Graham Number: √(22.5 × EPS × BVPS)
  const grahamCalc = (eps > 0 && bookValuePerShare > 0)
    ? Math.sqrt(22.5 * eps * bookValuePerShare).toFixed(2) : null;

  const newsText = (news || []).slice(0, 6)
    .map((n, i) => `${i + 1}. [${n.source}] ${n.title}${n.description ? ' — ' + n.description : ''}`)
    .join('\n') || 'No recent news available.';

  const schemaExample = {
    recommendation: 'BUY',
    confidence: 'High',
    fmv: `${cs} 000.00`,
    fmvVerdict: 'Undervalued',
    fmvUpside: 12.3,
    valuationMetrics: [
      { method: 'P/E vs Sector',  value: '00.0x', context: 'Sector avg: 00.0x',          signal: 'Undervalued' },
      { method: 'PEG Ratio',      value: '0.00',  context: '< 1 = undervalued, 1-2 fair', signal: 'Fair'        },
      { method: 'Graham Number',  value: `${cs} 000.00`, context: '√(22.5 × EPS × BVPS)',      signal: 'Fair'        },
      { method: 'DCF Estimate',   value: `${cs} 000.00`, context: '0% WACC, 0% growth',         signal: 'Undervalued' },
      { method: 'Price / Book',   value: '0.0x',  context: 'ROE: 00%',                   signal: 'Fair'        },
      { method: 'Price / Sales',  value: '0.0x',  context: 'Sector avg: 0.0x',           signal: 'Undervalued' },
      { method: 'EV / EBITDA',    value: '00.0x', context: 'Sector avg: 00.0x',          signal: 'Overvalued'  },
    ],
    valuation:   '2-3 sentences synthesising all 7 metrics into an overall valuation view.',
    fundamental: '2-3 sentences on balance sheet strength, margins, and growth trajectory.',
    sentiment:   '2-3 sentences on what the recent news implies for the near-term outlook.',
    risks:       ['Specific risk 1', 'Specific risk 2', 'Specific risk 3'],
    summary:     'One concise sentence recommendation explicitly weighing valuation + fundamentals + sentiment + risks.',
  };

  const prompt = [
    'You are a senior equity analyst. Deliver a rigorous multi-method valuation and investment recommendation.',
    'Use your knowledge of this company, sector, and peers to fill in any N/A fields.',
    '',
    '## Market Data',
    `Company : ${name} (${symbol})`,
    `Sector  : ${sector || 'N/A'} | Industry: ${industry || 'N/A'}`,
    `Price   : ${cs} ${price}${change ? ` (${change}% today)` : ''}`,
    `52w High: ${high52 ? `${cs} ${high52} (${fromHigh}% from now)` : 'N/A'}`,
    `52w Low : ${low52  ? `${cs} ${low52}  (${fromLow}% from now)`  : 'N/A'}`,
    `Mkt Cap : ${fmtNum(marketCap, ' ' + cs)} | Avg Vol: ${fmtNum(avgVolume)}`,
    `Dividend: ${dividendYield ? (dividendYield * 100).toFixed(2) + '%' : 'None'}`,
    '',
    '## Valuation Inputs (use these; estimate with your knowledge where N/A)',
    `P/E (TTM)          : ${pe                ? f1(pe)              : 'N/A'}`,
    `EPS (TTM)          : ${eps               ? `${cs} ${f2(eps)}`  : 'N/A'}`,
    `Book Value / Share : ${bookValuePerShare  ? `${cs} ${f2(bookValuePerShare)}` : 'N/A'}`,
    `Graham Number(calc): ${grahamCalc         ? `${cs} ${grahamCalc}` : 'N/A — compute √(22.5 × EPS × BVPS)'}`,
    `PEG Ratio          : ${pegRatio           ? f2(pegRatio)        : 'N/A — estimate from P/E ÷ forward EPS growth%'}`,
    `Price / Book       : ${pbRatio            ? f2(pbRatio) + 'x'  : 'N/A'}`,
    `Price / Sales      : ${psRatio            ? f2(psRatio) + 'x'  : 'N/A'}`,
    `EV / EBITDA        : ${evEbitda           ? f2(evEbitda) + 'x' : 'N/A'}`,
    `Return on Equity   : ${roe                ? (roe * 100).toFixed(1) + '%' : 'N/A'}`,
    '',
    '## Recent News & Sentiment',
    newsText,
    '',
    '## Output Rules',
    '- Respond ONLY with the JSON object below. No markdown, no code fences, no extra text.',
    `- fmv: weighted average of DCF, Graham Number, and sector-adjusted P/E target (format: "${cs} 000.00")`,
    '- fmvUpside: number = (fmv - currentPrice) / currentPrice × 100  (positive = upside)',
    '- fmvVerdict: "Undervalued" if fmvUpside > 10, "Overvalued" if fmvUpside < -10, else "Fairly Valued"',
    '- signal for each metric must be exactly one of: "Undervalued", "Fair", "Overvalued", "N/A"',
    '- recommendation (BUY/HOLD/SELL) must explicitly weigh all four sections: Valuation + Fundamentals + Sentiment + Risks',
    '- All string values in English',
    '',
    JSON.stringify(schemaExample, null, 2),
  ].join('\n');

  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-api-key':       apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 2048,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      res.setHeader('Access-Control-Allow-Origin', '*').setHeader('Content-Type', 'application/json')
        .status(502).json({ error: `Claude API error ${apiRes.status}: ${errText.slice(0, 300)}` }); return;
    }

    const data = await apiRes.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();

    // Strip accidental markdown fences
    const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    const start = clean.indexOf('{');
    const end   = clean.lastIndexOf('}');

    if (start === -1 || end === -1) {
      res.setHeader('Access-Control-Allow-Origin', '*').setHeader('Content-Type', 'application/json')
        .status(500).json({ error: 'No JSON in response. Got: ' + clean.slice(0, 200) }); return;
    }

    let analysis;
    try {
      analysis = JSON.parse(clean.slice(start, end + 1));
    } catch (parseErr) {
      res.setHeader('Access-Control-Allow-Origin', '*').setHeader('Content-Type', 'application/json')
        .status(500).json({ error: `JSON parse failed: ${parseErr.message} | Raw: ${clean.slice(0, 200)}` }); return;
    }

    if (!analysis.recommendation || !analysis.confidence) {
      res.setHeader('Access-Control-Allow-Origin', '*').setHeader('Content-Type', 'application/json')
        .status(500).json({ error: 'Incomplete analysis response', received: Object.keys(analysis) }); return;
    }

    res.setHeader('Access-Control-Allow-Origin', '*').setHeader('Content-Type', 'application/json')
      .status(200).json(analysis);

  } catch (err) {
    res.setHeader('Access-Control-Allow-Origin', '*').setHeader('Content-Type', 'application/json')
      .status(500).json({ error: 'Analysis failed: ' + err.message });
  }
}
