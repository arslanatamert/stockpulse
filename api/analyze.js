export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Origin','*').status(200).send(''); return; }
  if (req.method !== 'POST') { res.setHeader('Access-Control-Allow-Origin','*').setHeader('Content-Type','application/json').status(405).send('Method Not Allowed'); return; }

  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { res.setHeader('Access-Control-Allow-Origin','*').setHeader('Content-Type','application/json').status(500).send(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' })); return; }

  let body;
  try { body = JSON.parse(req.body); }
  catch { res.setHeader('Access-Control-Allow-Origin','*').setHeader('Content-Type','application/json').status(400).send(JSON.stringify({ error: 'Invalid JSON body' })); return; }

  const { name, symbol, currency, price, prevClose, high52, low52, pe, marketCap, avgVolume, dividendYield, news } = body;

  if (!name || !price) {
    res.setHeader('Access-Control-Allow-Origin','*').setHeader('Content-Type','application/json').status(400).send(JSON.stringify({ error: 'Missing required fields: name, price' })); return;
  }

  const change   = price && prevClose ? ((price - prevClose) / prevClose * 100).toFixed(2) : null;
  const fromHigh = high52 ? ((price - high52) / high52 * 100).toFixed(1) : null;
  const fromLow  = low52  ? ((price - low52)  / low52  * 100).toFixed(1) : null;
  const rangePos = high52 && low52 && price
    ? (((price - low52) / (high52 - low52)) * 100).toFixed(0) + '% through 52w range (0=low, 100=high)'
    : 'N/A';

  function fmtNum(n, suffix) { if (!n) return 'N/A'; if (n >= 1e9) return (n/1e9).toFixed(1) + 'B' + (suffix||''); if (n >= 1e6) return (n/1e6).toFixed(1) + 'M' + (suffix||''); return n + (suffix||''); }

  const newsText = (news || []).slice(0, 6)
    .map((n, i) => (i+1) + '. [' + n.source + '] ' + n.title + (n.description ? ' — ' + n.description : ''))
    .join('\n') || 'No recent news available.';

  const lines = [
    'You are a senior equity analyst providing a structured investment recommendation.',
    'Use your own knowledge of this company to supplement any N/A data fields.',
    '',
    '## Market Data',
    '- Company: ' + name + ' (' + symbol + ')',
    '- Price: ' + currency + ' ' + price + (change ? ' (' + change + '% today)' : ''),
    '- 52w High: ' + (high52 ? currency + ' ' + high52 + ' (' + fromHigh + '% from now)' : 'N/A'),
    '- 52w Low:  ' + (low52  ? currency + ' ' + low52  + ' (' + fromLow  + '% from now)' : 'N/A'),
    '- 52w Range Position: ' + rangePos,
    '- P/E Ratio: ' + (pe ? pe.toFixed(1) : 'N/A'),
    '- Market Cap: ' + fmtNum(marketCap, ' ' + currency),
    '- Avg Volume: ' + fmtNum(avgVolume),
    '- Dividend Yield: ' + (dividendYield ? (dividendYield * 100).toFixed(2) + '%' : 'None'),
    '',
    '## Recent News & Sentiment',
    newsText,
    '',
    '## Required Output',
    'Respond ONLY with a JSON object. No markdown, no code fences, no extra text. All string values in English.',
    '',
    '{"recommendation":"BUY","confidence":"High","targetPrice":"EUR 200","technical":"...","fundamental":"...","sentiment":"...","risks":["...","...","..."],"summary":"..."}',
    '',
    'recommendation: BUY, HOLD, or SELL',
    'confidence: Low, Medium, or High',
    'targetPrice: your fair value estimate as a string (e.g. "EUR 185") or null',
    'technical: 2-3 sentences on price action and trend',
    'fundamental: 2-3 sentences on valuation and financials',
    'sentiment: 2-3 sentences on what the news implies',
    'risks: array of exactly 3 risk strings',
    'summary: single sentence plain-language recommendation',
  ];

  const prompt = lines.join('\n');

  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      res.setHeader('Access-Control-Allow-Origin','*').setHeader('Content-Type','application/json').status(502).json({ error: 'Claude API error ' + apiRes.status + ': ' + errText.slice(0, 300) }); return;
    }

    const data = await apiRes.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();

    // Strip any accidental markdown fences
    const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    const start = clean.indexOf('{');
    const end   = clean.lastIndexOf('}');

    if (start === -1 || end === -1) {
      res.setHeader('Access-Control-Allow-Origin','*').setHeader('Content-Type','application/json').status(500).json({ error: 'No JSON in response. Got: ' + clean.slice(0, 200) }); return;
    }

    let analysis;
    try {
      analysis = JSON.parse(clean.slice(start, end + 1));
    } catch (parseErr) {
      res.setHeader('Access-Control-Allow-Origin','*').setHeader('Content-Type','application/json').status(500).json({ error: 'JSON parse failed: ' + parseErr.message + ' | Raw: ' + clean.slice(0, 200) }); return;
    }

    // Validate required fields
    if (!analysis.recommendation || !analysis.confidence) {
      res.setHeader('Access-Control-Allow-Origin','*').setHeader('Content-Type','application/json').status(500).json({ error: 'Incomplete analysis response', received: Object.keys(analysis) }); return;
    }

    res.setHeader('Access-Control-Allow-Origin','*').setHeader('Content-Type','application/json').status(200).json(analysis); return;

  } catch (err) {
    res.setHeader('Access-Control-Allow-Origin','*').setHeader('Content-Type','application/json').status(500).send(JSON.stringify({ error: 'Analysis failed: ' + err.message })); return;
  }
}
