// Composite 0–100 score combining recommendation, confidence, FMV upside, and sentiment signal.
// Higher score = stronger buy signal.
export function scoreStock({ recommendation, confidence, fmvUpside, sentiment, fundamental }) {
  // Recommendation: 0–40 pts
  const recScore = recommendation === 'BUY' ? 40 : recommendation === 'HOLD' ? 15 : 0;

  // Confidence: 0–20 pts
  const confScore = confidence === 'High' ? 20 : confidence === 'Medium' ? 12 : 5;

  // FMV Upside: 0–25 pts. 50%+ upside = full 25 pts; negative upside = 0.
  const upside = typeof fmvUpside === 'number' ? fmvUpside : parseFloat(fmvUpside) || 0;
  const fmvScore = Math.min(25, Math.max(0, upside * 0.5));

  // Sentiment: keyword scan of Claude's sentiment + fundamental sentences → 0/8/15 pts
  const text = ((sentiment || '') + ' ' + (fundamental || '')).toLowerCase();
  const posWords = ['positive','strong','bullish','growth','beat','upgrade','record','surge','robust','solid','momentum','outperform'];
  const negWords = ['negative','weak','bearish','miss','downgrade','concern','loss','decline','risk','pressure','headwind'];
  const posHits = posWords.filter(w => text.includes(w)).length;
  const negHits = negWords.filter(w => text.includes(w)).length;
  const sentScore = posHits > negHits ? 15 : posHits < negHits ? 0 : 8;

  return Math.round(recScore + confScore + fmvScore + sentScore);
}
