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

  const cs  = currency || 'EUR';
  const pct = (a, b) => b ? ((a - b) / b * 100).toFixed(1) : null;
  const f1  = n => n != null ? Number(n).toFixed(1) : 'N/A';
  const f2  = n => n != null ? Number(n).toFixed(2) : 'N/A';
  const fmc = n => { if (!n) return 'N/A'; if (n >= 1e9) return (n/1e9).toFixed(1)+'B'; if (n >= 1e6) return (n/1e6).toFixed(1)+'M'; return n; };

  const chg     = pct(price, prevClose);
  const graham  = (eps > 0 && bookValuePerShare > 0) ? Math.sqrt(22.5 * eps * bookValuePerShare).toFixed(2) : null;

  // 3 news titles only — descriptions cut to save tokens
  const newsBrief = (news || []).slice(0, 3).map((n, i) => `${i+1}.${n.title}`).join(' ') || 'None';

  // Compact single-line schema template
  const schema = `{"recommendation":"BUY","confidence":"High","fmv":"${cs} 0.00","fmvVerdict":"Undervalued","fmvUpside":0.0,"valuationMetrics":[{"method":"P/E vs Sector","value":"0x","context":"sector 0x","signal":"Fair"},{"method":"PEG Ratio","value":"0.0","context":"<1=cheap","signal":"Fair"},{"method":"Graham Number","value":"${cs} 0","context":"√22.5×EPS×BVPS","signal":"Fair"},{"method":"DCF Estimate","value":"${cs} 0","context":"0%WACC 0%g","signal":"Fair"},{"method":"Price / Book","value":"0x","context":"ROE 0%","signal":"Fair"},{"method":"Price / Sales","value":"0x","context":"sector 0x","signal":"Fair"},{"method":"EV / EBITDA","value":"0x","context":"sector 0x","signal":"Fair"}],"valuation":"2 sentences.","fundamental":"2 sentences.","sentiment":"2 sentences.","risks":["r1","r2","r3"],"summary":"1 sentence."}`;

  const prompt = [
    `Equity analyst. JSON only, no markdown. Use your knowledge to fill N/A gaps.`,
    `${name} (${symbol}) | ${sector||'?'}/${industry||'?'} | ${cs}${price}${chg ? ` (${chg}%)` : ''}`,
    `MCap:${fmc(marketCap)} 52w:${low52||'?'}–${high52||'?'} Div:${dividendYield ? (dividendYield*100).toFixed(1)+'%' : 'none'}`,
    `PE:${f1(pe)} EPS:${f2(eps)} BVPS:${f2(bookValuePerShare)} Graham:${graham||'N/A'} PEG:${f2(pegRatio)} PB:${f2(pbRatio)} PS:${f2(psRatio)} EV/EBITDA:${f2(evEbitda)} ROE:${roe ? (roe*100).toFixed(1)+'%' : 'N/A'}`,
    `News: ${newsBrief}`,
    schema,
    `fmvUpside=(fmv-price)/price×100. Undervalued>10%, Overvalued<-10%. signal=Undervalued|Fair|Overvalued|N/A. BUY/HOLD/SELL from valuation+fundamentals+sentiment+risks.`,
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
        max_tokens: 550,
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
