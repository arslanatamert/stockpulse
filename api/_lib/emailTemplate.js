// HTML + plain-text email builders for the daily stock report.
// All CSS is inline — email clients strip <style> blocks.

function badge(rec) {
  const colors = { BUY: '#00d084', HOLD: '#f59e0b', SELL: '#ff4d4d' };
  const bg = colors[rec] || '#555';
  return `<span style="background:${bg};color:#000;font-size:11px;font-weight:bold;padding:2px 7px;border-radius:3px;">${rec}</span>`;
}

function confDot(conf) {
  const colors = { High: '#00d084', Medium: '#f59e0b', Low: '#ff4d4d' };
  return `<span style="color:${colors[conf] || '#aaa'};">●</span> ${conf}`;
}

function scoreBreakdown(s) {
  const recScore  = s.recommendation === 'BUY' ? 40 : s.recommendation === 'HOLD' ? 15 : 0;
  const confScore = s.confidence === 'High' ? 20 : s.confidence === 'Medium' ? 12 : 5;
  const upsideVal = typeof s.fmvUpside === 'number' ? s.fmvUpside : parseFloat(s.fmvUpside) || 0;
  const fmvScore  = Math.round(Math.min(25, Math.max(0, upsideVal * 0.5)));
  const text      = ((s.sentiment || '') + ' ' + (s.fundamental || '')).toLowerCase();
  const pos = ['positive','strong','bullish','growth','beat','upgrade','record','surge','robust','solid','momentum','outperform'];
  const neg = ['negative','weak','bearish','miss','downgrade','concern','loss','decline','risk','pressure','headwind'];
  const sentScore = pos.filter(w => text.includes(w)).length > neg.filter(w => text.includes(w)).length ? 15
                  : pos.filter(w => text.includes(w)).length < neg.filter(w => text.includes(w)).length ? 0 : 8;
  return { recScore, confScore, fmvScore, sentScore };
}

function upside(val) {
  const n = typeof val === 'number' ? val : parseFloat(val) || 0;
  const color = n >= 10 ? '#00d084' : n <= -10 ? '#ff4d4d' : '#f59e0b';
  const sign = n >= 0 ? '+' : '';
  return `<span style="color:${color};font-weight:bold;">${sign}${n.toFixed(1)}%</span>`;
}

export function buildEmailHtml({ asOf, rankedStocks, buySignals, topPick }) {
  const date = new Date(asOf).toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const holdList = rankedStocks.filter(s => s.recommendation === 'HOLD');
  const sellList = rankedStocks.filter(s => s.recommendation === 'SELL');

  const topPickHtml = topPick ? `
    <tr>
      <td style="padding:0 20px 20px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d1f0d;border:1px solid #00d084;border-radius:8px;">
          <tr>
            <td style="padding:18px 20px;">
              <p style="color:#00d084;margin:0 0 6px;font-size:11px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;">⭐ Top Pick Today</p>
              <h2 style="color:#fff;margin:0 0 4px;font-size:22px;">${topPick.label}</h2>
              <p style="color:#888;margin:0 0 10px;font-size:13px;">${topPick.sym} · ${topPick.currency} ${topPick.price?.toFixed ? topPick.price.toFixed(2) : topPick.price}</p>
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-right:16px;">${badge('BUY')}</td>
                  <td style="color:#aaa;font-size:13px;padding-right:16px;">${confDot(topPick.confidence)} confidence</td>
                  <td style="color:#aaa;font-size:13px;">FMV upside: ${upside(topPick.fmvUpside)}</td>
                </tr>
              </table>
              <p style="color:#ccc;margin:12px 0 4px;font-size:14px;line-height:1.5;">${topPick.summary || ''}</p>
              ${topPick.risks && topPick.risks.length ? `<p style="color:#888;margin:8px 0 0;font-size:12px;">⚠ Risks: ${topPick.risks.slice(0,3).join(' · ')}</p>` : ''}
            </td>
          </tr>
        </table>
      </td>
    </tr>` : '';

  const buyRows = buySignals.map((s, i) => {
    const bd = scoreBreakdown(s);
    return `
    <tr style="border-bottom:1px solid #222;">
      <td style="padding:10px 8px;color:#666;font-size:13px;">${i + 1}</td>
      <td style="padding:10px 8px;">
        <p style="color:#fff;margin:0;font-size:14px;font-weight:bold;">${s.label}</p>
        <p style="color:#555;margin:0;font-size:11px;">${s.sym}</p>
      </td>
      <td style="padding:10px 8px;text-align:center;">
        <span style="color:#c8ff00;font-weight:bold;font-size:16px;">${s.score}</span><br>
        <span style="color:#444;font-size:10px;white-space:nowrap;">R:${bd.recScore}+C:${bd.confScore}+F:${bd.fmvScore}+S:${bd.sentScore}</span>
      </td>
      <td style="padding:10px 8px;text-align:center;">${upside(s.fmvUpside)}</td>
      <td style="padding:10px 8px;">${confDot(s.confidence)}</td>
      <td style="padding:10px 8px;color:#aaa;font-size:12px;max-width:200px;">${s.summary || ''}</td>
    </tr>`;
  }).join('');

  const watchlistRows = [...holdList, ...sellList].map(s => `
    <tr style="border-bottom:1px solid #1a1a1a;">
      <td style="padding:8px;">${badge(s.recommendation)}</td>
      <td style="padding:8px;color:#ccc;font-size:13px;">${s.label} <span style="color:#444;">(${s.sym})</span></td>
      <td style="padding:8px;">${upside(s.fmvUpside)}</td>
      <td style="padding:8px;color:#888;font-size:12px;">${s.summary || ''}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;">
  <tr><td align="center" style="padding:20px 10px;">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

      <!-- Header -->
      <tr>
        <td style="background:#111;border-radius:8px 8px 0 0;padding:24px 20px;text-align:center;border-bottom:1px solid #1e1e1e;">
          <h1 style="color:#c8ff00;margin:0;font-size:26px;font-family:Arial,sans-serif;letter-spacing:-1px;">📊 StockPulse</h1>
          <p style="color:#666;margin:6px 0 0;font-size:13px;font-family:Arial,sans-serif;">Daily Report — ${date}</p>
          <p style="color:#444;margin:4px 0 0;font-size:12px;font-family:Arial,sans-serif;">${buySignals.length} BUY signal${buySignals.length !== 1 ? 's' : ''} · ${rankedStocks.length} stocks analyzed</p>
        </td>
      </tr>

      <!-- Top Pick -->
      ${topPickHtml}

      ${buySignals.length > 0 ? `
      <!-- BUY Signals Table -->
      <tr>
        <td style="padding:0 20px 20px;">
          <p style="color:#00d084;font-family:Arial,sans-serif;font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;margin:0 0 10px;">🟢 Buy Signals</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #1e1e1e;border-radius:6px;overflow:hidden;">
            <tr style="background:#161616;">
              <th style="padding:8px;color:#555;font-size:11px;font-family:Arial,sans-serif;text-align:left;">#</th>
              <th style="padding:8px;color:#555;font-size:11px;font-family:Arial,sans-serif;text-align:left;">Stock</th>
              <th style="padding:8px;color:#555;font-size:11px;font-family:Arial,sans-serif;text-align:center;">Score</th>
              <th style="padding:8px;color:#555;font-size:11px;font-family:Arial,sans-serif;text-align:center;">FMV Upside</th>
              <th style="padding:8px;color:#555;font-size:11px;font-family:Arial,sans-serif;text-align:left;">Confidence</th>
              <th style="padding:8px;color:#555;font-size:11px;font-family:Arial,sans-serif;text-align:left;">Summary</th>
            </tr>
            ${buyRows}
          </table>
          <!-- Score methodology legend -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;background:#0d0d0d;border:1px solid #1e1e1e;border-radius:6px;">
            <tr>
              <td colspan="4" style="padding:8px 12px 2px;color:#444;font-size:10px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;font-family:Arial,sans-serif;">Score = R + C + F + S &nbsp;(max 100)</td>
            </tr>
            <tr>
              <td style="padding:4px 12px;font-family:Arial,sans-serif;font-size:11px;color:#666;"><span style="color:#c8ff00;font-weight:bold;">R</span> Rec</td>
              <td style="padding:4px 4px;font-family:Arial,sans-serif;font-size:11px;color:#444;">BUY 40 · HOLD 15 · SELL 0</td>
              <td style="padding:4px 12px;font-family:Arial,sans-serif;font-size:11px;color:#666;"><span style="color:#c8ff00;font-weight:bold;">C</span> Confidence</td>
              <td style="padding:4px 4px;font-family:Arial,sans-serif;font-size:11px;color:#444;">High 20 · Med 12 · Low 5</td>
            </tr>
            <tr>
              <td style="padding:4px 12px 8px;font-family:Arial,sans-serif;font-size:11px;color:#666;"><span style="color:#c8ff00;font-weight:bold;">F</span> FMV upside</td>
              <td style="padding:4px 4px 8px;font-family:Arial,sans-serif;font-size:11px;color:#444;">upside% × 0.5, max 25</td>
              <td style="padding:4px 12px 8px;font-family:Arial,sans-serif;font-size:11px;color:#666;"><span style="color:#c8ff00;font-weight:bold;">S</span> Sentiment</td>
              <td style="padding:4px 4px 8px;font-family:Arial,sans-serif;font-size:11px;color:#444;">keyword scan: 15 / 8 / 0</td>
            </tr>
          </table>
        </td>
      </tr>` : `
      <tr>
        <td style="padding:0 20px 20px;text-align:center;">
          <p style="color:#666;font-family:Arial,sans-serif;font-size:14px;">No BUY signals today. Check back tomorrow.</p>
        </td>
      </tr>`}

      ${watchlistRows ? `
      <!-- Watchlist -->
      <tr>
        <td style="padding:0 20px 20px;">
          <p style="color:#888;font-family:Arial,sans-serif;font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;margin:0 0 10px;">📋 Watchlist (Hold / Sell)</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #1a1a1a;border-radius:6px;overflow:hidden;">
            ${watchlistRows}
          </table>
        </td>
      </tr>` : ''}

      <!-- Footer -->
      <tr>
        <td style="background:#0d0d0d;border-radius:0 0 8px 8px;padding:16px 20px;text-align:center;border-top:1px solid #1a1a1a;">
          <p style="color:#333;font-family:Arial,sans-serif;font-size:11px;margin:0;line-height:1.6;">
            StockPulse automated analysis · Not financial advice · Past performance does not guarantee future results<br>
            Generated at ${new Date(asOf).toUTCString()}
          </p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

export function buildEmailText({ asOf, buySignals, topPick, rankedStocks }) {
  const date = new Date(asOf).toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const lines = [
    `STOCKPULSE DAILY REPORT — ${date}`,
    `${buySignals.length} BUY signals of ${rankedStocks.length} analyzed`,
    '',
  ];

  if (topPick) {
    const up = typeof topPick.fmvUpside === 'number' ? topPick.fmvUpside.toFixed(1) : topPick.fmvUpside;
    lines.push(`⭐ TOP PICK: ${topPick.label} (${topPick.sym})`);
    lines.push(`   BUY · ${topPick.confidence} confidence · +${up}% FMV upside`);
    lines.push(`   ${topPick.summary}`);
    lines.push('');
  }

  if (buySignals.length > 0) {
    lines.push('BUY SIGNALS:');
    buySignals.forEach((s, i) => {
      const up = typeof s.fmvUpside === 'number' ? s.fmvUpside.toFixed(1) : s.fmvUpside;
      const bd = scoreBreakdown(s);
      lines.push(`${i + 1}. ${s.label} (${s.sym}) — Score: ${s.score} [R:${bd.recScore}+C:${bd.confScore}+F:${bd.fmvScore}+S:${bd.sentScore}] · FMV upside: +${up}% · ${s.confidence} confidence`);
      if (s.summary) lines.push(`   ${s.summary}`);
    });
    lines.push('');
  }

  lines.push('Score methodology (max 100):');
  lines.push('  R Recommendation : BUY=40, HOLD=15, SELL=0');
  lines.push('  C Confidence      : High=20, Medium=12, Low=5');
  lines.push('  F FMV Upside      : upside% × 0.5, capped at 25');
  lines.push('  S Sentiment       : keyword scan of AI text → 15/8/0');
  lines.push('');
  lines.push('---');
  lines.push('Automated analysis — not financial advice.');
  return lines.join('\n');
}
