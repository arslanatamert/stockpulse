import { buildPrompt } from './_lib/buildPrompt.js';

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

  const { name, price } = body;

  if (!name || !price) {
    res.setHeader('Access-Control-Allow-Origin', '*').setHeader('Content-Type', 'application/json')
      .status(400).json({ error: 'Missing required fields: name, price' }); return;
  }

  const { system, user: prompt } = buildPrompt(body);

  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 1024,
        system,
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
