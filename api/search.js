export default async function handler(req, res) {
  const q = (req.query.q || '').trim();
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (!q || q.length < 2) { res.setHeader('Access-Control-Allow-Origin','*').setHeader('Content-Type','application/json').status(200).send(JSON.stringify([])); return; }

  try {
    const yRes = await fetch(
      `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&lang=en-US&region=DE&quotesCount=8&newsCount=0&enableFuzzyQuery=true&quotesQueryId=tss_match_phrase_query`,
      { signal: AbortSignal.timeout(5000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
          'Referer': 'https://finance.yahoo.com/',
        }
      }
    );
    if (!yRes.ok) { res.setHeader('Access-Control-Allow-Origin','*').setHeader('Content-Type','application/json').status(200).send(JSON.stringify([])); return; }

    const data = await yRes.json();
    const quotes = (data.quotes || [])
      .filter(q => q.symbol && q.quoteType !== 'FUTURE' && q.quoteType !== 'OPTION')
      .slice(0, 8)
      .map(q => ({
        symbol:   q.symbol,
        name:     q.longname || q.shortname || q.symbol,
        exchange: q.exchDisp || q.exchange || '',
        type:     q.quoteType || '',
        currency: q.currency || '',
      }));

    res.setHeader('Access-Control-Allow-Origin','*').setHeader('Content-Type','application/json').status(200).send(JSON.stringify(quotes)); return;
  } catch (e) {
    res.setHeader('Access-Control-Allow-Origin','*').setHeader('Content-Type','application/json').status(200).send(JSON.stringify([])); return;
  }
};
