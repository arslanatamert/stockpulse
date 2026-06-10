// WhatsApp message builder — kept short (target <640 chars for 2 segments max).
export function buildWhatsAppText({ asOf, buySignals, topPick, rankedStocks }) {
  const date = new Date(asOf).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const lines = [`📊 *StockPulse* — ${date}`];

  if (topPick) {
    const up = typeof topPick.fmvUpside === 'number' ? topPick.fmvUpside.toFixed(1) : topPick.fmvUpside;
    lines.push('');
    lines.push(`🟢 *TOP BUY: ${topPick.label}*`);
    lines.push(`+${up}% FMV upside · ${topPick.confidence} confidence`);
    // Truncate summary to keep message short
    const summary = (topPick.summary || '').slice(0, 100);
    if (summary) lines.push(summary);
  } else {
    lines.push('');
    lines.push('No BUY signals today.');
  }

  const others = buySignals.filter(s => s.sym !== topPick?.sym).slice(0, 3);
  if (others.length > 0) {
    lines.push('');
    lines.push(`Also BUY: ${others.map(s => s.label).join(', ')}`);
  }

  lines.push('');
  lines.push(`${buySignals.length} buy signal${buySignals.length !== 1 ? 's' : ''} of ${rankedStocks.length} analyzed.`);
  lines.push('Full report → check email 📧');

  return lines.join('\n');
}
