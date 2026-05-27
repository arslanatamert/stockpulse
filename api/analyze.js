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

  // Titles only — dropping descriptions saves ~200 input tokens
  const newsText = (news || []).slice(0, 6)
    .map((n, i) => `${i + 1}. [${n.source}] ${n.title}`)
    .join('\n') || 'No recent news.';

  // Compact single-line schema — saves ~270 tokens vs pretty-printed
  const schema = `{"recommendation":"BUY","confidence":"High","fmv":"${cs} 0.00","fmvVerdict":"Undervalued","fmvUpside":0.0,"valuationMetrics":[{"method":"P/E vs Sector","value":"0x","context":"sector 0x","signal":"Fair"},{"method":"PEG Ratio","value":"0.0","context":"<1=cheap","signal":"Fair"},{"method":"Graham Number","value":"${cs} 0","context":"√22.5×EPS×BVPS","signal":"Fair"},{"method":"DCF Estimate","value":"${cs} 0","context":"0%WACC 0%g","signal":"Fair"},{"method":"Price / Book","value":"0x","context":"ROE 0%","signal":"Fair"},{"method":"Price / Sales","value":"0x","context":"sector 0x","signal":"Fair"},{"method":"EV / EBITDA","value":"0x","context":"sector 0x","signal":"Fair"}],"valuation":"1 sentence.","fundamental":"1 sentence.","sentiment":"1 sentence.","risks":["r1","r2","r3"],"summary":"1 sentence."}`;

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
    '## Valuation Inputs (estimate with your knowledge where N/A)',
    `P/E: ${pe ? f1(pe) : 'N/A'} | EPS: ${eps ? `${cs} ${f2(eps)}` : 'N/A'} | BVPS: ${bookValuePerShare ? `${cs} ${f2(bookValuePerShare)}` : 'N/A'} | Graham: ${grahamCalc ? `${cs} ${grahamCalc}` : 'compute √(22.5×EPS×BVPS)'}`,
    `PEG: ${pegRatio ? f2(pegRatio) : 'estimate'} | P/B: ${pbRatio ? f2(pbRatio)+'x' : 'N/A'} | P/S: ${psRatio ? f2(psRatio)+'x' : 'N/A'} | EV/EBITDA: ${evEbitda ? f2(evEbitda)+'x' : 'N/A'} | ROE: ${roe ? (roe*100).toFixed(1)+'%' : 'N/A'}`,
    '',
    '## Recent News',
    newsText,
    '',
    '## Output — respond ONLY with compact single-line JSON (no whitespace, no newlines, no indentation):',
    `- fmv: weighted avg of DCF + Graham + sector P/E target, formatted as "${cs} 0.00"`,
    '- fmvUpside: (fmv − price) / price × 100',
    '- fmvVerdict: "Undervalued" >10%, "Overvalued" <−10%, else "Fairly Valued"',
    '- signal: exactly "Undervalued", "Fair", "Overvalued", or "N/A"',
    '- valuation / fundamental / sentiment: MAX 1 concise sentence each',
    '- recommendation (BUY/HOLD/SELL) derived from all 4 sections combined',
    '- IMPORTANT: output must be a single line of JSON with no whitespace between tokens',
    '',
    schema,
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
        max_tokens: 1024,
        system:     'You are a JSON-only financial analysis API. Output a single compact JSON object with no whitespace. Never write any text, reasoning, explanation, or markdown before or after the JSON. Your entire response must be one line starting with { and ending with }.',
        messages:   [{ role: 'user', content: prompt }],
      }),
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      res.setHeader('Access-Control-Allow-Origin', '*').setHeader('Content-Type', 'application/json')
        .status(502).json({ error: `Claude API error ${apiRes.status}: ${errText.slice(0, 300)}` }); return;
    }

    const data = await apiRes.json();
    const text  = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();

    // Strip any accidental markdown fences, then find the JSON object boundaries
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
