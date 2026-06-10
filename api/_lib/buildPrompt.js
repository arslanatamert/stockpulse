// Shared Claude prompt builder — used by both analyze.js (web) and submit-batch.js (cron report).
// Returns { system, user } strings ready for the Anthropic Messages API.

export function buildPrompt({
  name, symbol, currency, price, prevClose, high52, low52,
  pe, marketCap, avgVolume, dividendYield,
  eps, bookValuePerShare, pbRatio, psRatio, evEbitda, pegRatio, roe,
  sector, industry, news,
  lang = 'en',
}) {
  const isTR = lang === 'tr';
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

  const grahamCalc = (eps > 0 && bookValuePerShare > 0)
    ? Math.sqrt(22.5 * eps * bookValuePerShare).toFixed(2) : null;

  const newsText = (news || []).slice(0, 6)
    .map((n, i) => `${i + 1}. [${n.source}] ${n.title}`)
    .join('\n') || 'No recent news.';

  const schema = `{"recommendation":"BUY","confidence":"High","fmv":"${cs} 0.00","fmvVerdict":"Undervalued","fmvUpside":0.0,"valuationMetrics":[{"method":"P/E vs Sector","value":"0x","context":"sector 0x","signal":"Fair"},{"method":"PEG Ratio","value":"0.0","context":"<1=cheap","signal":"Fair"},{"method":"Graham Number","value":"${cs} 0","context":"√22.5×EPS×BVPS","signal":"Fair"},{"method":"DCF Estimate","value":"${cs} 0","context":"0%WACC 0%g","signal":"Fair"},{"method":"Price / Book","value":"0x","context":"ROE 0%","signal":"Fair"},{"method":"Price / Sales","value":"0x","context":"sector 0x","signal":"Fair"},{"method":"EV / EBITDA","value":"0x","context":"sector 0x","signal":"Fair"}],"valuation":"1 sentence.","fundamental":"1 sentence.","sentiment":"1 sentence.","risks":["r1","r2","r3"],"summary":"1 sentence."}`;

  const user = [
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
    isTR
      ? '- LANGUAGE: write valuation, fundamental, sentiment, risks, summary, confidence, and all valuationMetrics method/context fields in Turkish. Keep recommendation (BUY/HOLD/SELL), fmvVerdict (Undervalued/Overvalued/Fairly Valued), and signal (Undervalued/Fair/Overvalued) in English.'
      : '- Write all text fields in English.',
    '- IMPORTANT: output must be a single line of JSON with no whitespace between tokens',
    '',
    schema,
  ].join('\n');

  const system = `You are a JSON-only financial analysis API. Output a single compact JSON object with no whitespace. Never write any text, reasoning, explanation, or markdown before or after the JSON. Your entire response must be one line starting with { and ending with }.${isTR ? ' Write all narrative text fields in Turkish.' : ''}`;

  return { system, user };
}
