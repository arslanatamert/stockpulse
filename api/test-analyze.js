export default async function handler(req, res) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) res.setHeader('Access-Control-Allow-Origin','*').setHeader('Content-Type','application/json').status(500).send(JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' })); return;

  // Minimal test payload
  const testData = {
    name: 'Airbus SE', symbol: 'AIR.DE', currency: 'EUR',
    price: 169.66, prevClose: 167.64, high52: 221.25, low52: 154.10,
    pe: 28.5, marketCap: 134000000000, avgVolume: 1200000, dividendYield: 0.017,
    news: [{ source: 'Reuters', title: 'Airbus raises 2026 production targets', description: 'Strong A320 demand drives outlook upgrade.' }]
  };

  const { name, symbol, currency, price, prevClose, high52, low52, pe, marketCap, avgVolume, dividendYield, news } = testData;
  const change = ((price - prevClose) / prevClose * 100).toFixed(2);
  const rangePos = (((price - low52) / (high52 - low52)) * 100).toFixed(0) + '% through 52w range';
  const newsText = news.map((n,i) => `${i+1}. [${n.source}] ${n.title} — ${n.description}`).join('\n');

  const prompt = [
    'You are a senior equity analyst. Provide a structured investment recommendation.',
    '', '## Market Data',
    `- Company: ${name} (${symbol})`,
    `- Price: ${currency} ${price} (${change}% today)`,
    `- 52w Range: ${currency} ${low52} – ${currency} ${high52} | Position: ${rangePos}`,
    `- P/E: ${pe} | Mkt Cap: EUR ${(marketCap/1e9).toFixed(1)}B | Div: ${(dividendYield*100).toFixed(1)}%`,
    '', '## Recent News', newsText,
    '', '## Instructions',
    'Respond ONLY with valid JSON, no markdown, all fields in English:',
    '{"recommendation":"BUY"|"HOLD"|"SELL","confidence":"Low"|"Medium"|"High","targetPrice":"string or null",',
    '"technical":"2-3 sentences","fundamental":"2-3 sentences","sentiment":"2-3 sentences",',
    '"risks":["risk1","risk2","risk3"],"summary":"1 sentence"}'
  ].join('\n');

  const t0 = Date.now();
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1024, messages: [{ role: 'user', content: prompt }] }),
    });

    const elapsed = Date.now() - t0;
    const responseText = await res.text();

    if (!res.ok) {
      res.setHeader('Access-Control-Allow-Origin','*').setHeader('Content-Type','application/json').status(200).send(JSON.stringify({
        status: 'FAIL', stage: 'API call', httpStatus: res.status,
        error: responseText, elapsed
      })); return;
    }

    const data = JSON.parse(responseText);
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');

    let parsed;
    try {
      const clean = text.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(clean.slice(clean.indexOf('{'), clean.lastIndexOf('}') + 1));
    } catch(e) {
      res.setHeader('Access-Control-Allow-Origin','*').setHeader('Content-Type','application/json').status(200).json({
        status: 'FAIL', stage: 'JSON parse', error: e.message, rawResponse: text.slice(0, 500), elapsed
      });
    }

    res.setHeader('Access-Control-Allow-Origin','*').setHeader('Content-Type','application/json').status(200).json({
      status: 'PASS',
      elapsed: elapsed + 'ms',
      recommendation: parsed.recommendation,
      confidence: parsed.confidence,
      targetPrice: parsed.targetPrice,
      summary: parsed.summary,
      hasRisks: Array.isArray(parsed.risks) && parsed.risks.length > 0,
      fields: Object.keys(parsed),
    });
  } catch(e) {
    res.setHeader('Access-Control-Allow-Origin','*').setHeader('Content-Type','application/json').status(200).json({ status: 'ERROR', error: e.message, elapsed: Date.now() - t0 });
  }
}
