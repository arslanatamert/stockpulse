export default async function handler(req, res) {
  const sym = (req.query.sym || 'NTO.F').toUpperCase();
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  const yh = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json', 'Referer': 'https://finance.yahoo.com/',
  };

  const urls = {
    '1d_5m':  `https://query2.finance.yahoo.com/v8/finance/chart/${sym}?interval=5m&range=1d`,
    '5d_1d':  `https://query2.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=5d`,
    '1y_1wk': `https://query2.finance.yahoo.com/v8/finance/chart/${sym}?interval=1wk&range=1y`,
  };

  const results = {};
  for (const [label, url] of Object.entries(urls)) {
    try {
      const res = await fetch(url, { headers: yh });
      const data = await res.json();
      const meta = data.chart?.result?.[0]?.meta || {};
      const closes = data.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];
      const validCloses = closes.filter(v => v != null);
      results[label] = {
        httpStatus: res.status,
        regularMarketPrice:         meta.regularMarketPrice,
        regularMarketPreviousClose: meta.regularMarketPreviousClose,
        chartPreviousClose:         meta.chartPreviousClose,
        previousClose:              meta.previousClose,
        firstClose:  validCloses[0]   ?? null,
        lastClose:   validCloses[validCloses.length - 1] ?? null,
        pointCount:  validCloses.length,
      };
    } catch(e) {
      results[label] = { error: e.message };
    }
  }

  // Show what our current logic would pick
  const d1  = results['1d_5m'];
  const d2d = results['5d_1d'];
  const main = results['1y_1wk'];
  let chosen = null, source = null;
  if (d1?.chartPreviousClose)  { chosen = d1.chartPreviousClose;  source = '1d_5m.chartPreviousClose'; }
  else if (d2d?.chartPreviousClose) { chosen = d2d.chartPreviousClose; source = '5d_1d.chartPreviousClose'; }
  else if (d1?.previousClose)  { chosen = d1.previousClose;  source = '1d_5m.previousClose'; }
  else if (main?.regularMarketPreviousClose) { chosen = main.regularMarketPreviousClose; source = '1y_1wk.regularMarketPreviousClose'; }

  const price = main?.regularMarketPrice;
  const change = chosen && price ? ((price - chosen) / chosen * 100).toFixed(2) + '%' : 'N/A';

  res.setHeader('Access-Control-Allow-Origin','*').setHeader('Content-Type','application/json').status(200).send(JSON.stringify({ sym, chosenPrevClose: chosen, source, currentPrice: price, impliedChange: change, details: results }, null, 2)); return;
};
