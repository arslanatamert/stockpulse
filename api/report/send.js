// Cron job #2 — runs at 7:00 AM UTC Mon–Fri (8 AM CET / 9 AM CEST).
// Retrieves Anthropic Batch results, scores + ranks stocks, sends HTML email
// via Resend and a WhatsApp summary via Twilio.

import { scoreStock }         from '../lib/scoreStock.js';
import { buildEmailHtml, buildEmailText } from '../lib/emailTemplate.js';
import { buildWhatsAppText }  from '../lib/whatsappTemplate.js';

export const config = { maxDuration: 60 };

async function upstashGet(key) {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const r = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  const { result } = await r.json();
  return result;
}

function parseAnalysis(text) {
  if (!text) return null;
  const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const start = clean.indexOf('{');
  const end   = clean.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try { return JSON.parse(clean.slice(start, end + 1)); } catch { return null; }
}

export default async function handler(req, res) {
  // Auth — same CRON_SECRET as submit-batch
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers['authorization'];
  const querySecret = req.query?.secret;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}` && querySecret !== cronSecret) {
    return res.setHeader('Content-Type', 'application/json').status(401).json({ error: 'Unauthorized' });
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return res.setHeader('Content-Type', 'application/json').status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
  }

  // --- Step 1: Read batch ID + stock data from Redis ---
  const [batchId, stockJson, submittedAt] = await Promise.all([
    upstashGet('report:batch_id'),
    upstashGet('report:stock_data'),
    upstashGet('report:submitted_at'),
  ]);

  if (!batchId) {
    return res.setHeader('Content-Type', 'application/json').status(404).json({
      error: 'No batch ID found in Redis. Run /api/report/submit-batch first.',
    });
  }

  const stocks = stockJson ? JSON.parse(stockJson) : [];

  // --- Step 2: Check batch status ---
  const statusRes = await fetch(`https://api.anthropic.com/v1/messages/batches/${batchId}`, {
    headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
  });
  if (!statusRes.ok) {
    return res.setHeader('Content-Type', 'application/json').status(502).json({ error: `Anthropic status check failed: ${statusRes.status}` });
  }
  const batchStatus = await statusRes.json();

  if (batchStatus.processing_status !== 'ended') {
    return res.setHeader('Content-Type', 'application/json').status(202).json({
      status: 'batch_not_ready',
      processing_status: batchStatus.processing_status,
      batchId,
      submittedAt,
    });
  }

  // --- Step 3: Retrieve batch results (JSONL stream) ---
  const resultsUrl = batchStatus.results_url;
  const resultsRes = await fetch(resultsUrl, {
    headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
  });
  if (!resultsRes.ok) {
    return res.setHeader('Content-Type', 'application/json').status(502).json({ error: `Failed to fetch batch results: ${resultsRes.status}` });
  }

  const jsonl = await resultsRes.text();
  const analysisMap = {};
  for (const line of jsonl.trim().split('\n')) {
    if (!line.trim()) continue;
    try {
      const { custom_id, result } = JSON.parse(line);
      if (result?.type === 'succeeded') {
        const text = (result.message?.content || [])
          .filter(b => b.type === 'text').map(b => b.text).join('').trim();
        const analysis = parseAnalysis(text);
        if (analysis) analysisMap[custom_id.replace(/\./g, '_')] = analysis;
      }
    } catch {}
  }

  // --- Step 4: Merge stock data with analysis, score, and sort ---
  const rankedStocks = stocks
    .filter(s => analysisMap[s.sym.replace(/\./g, '_')])
    .map(s => ({
      ...s,
      ...analysisMap[s.sym.replace(/\./g, '_')],
      score: scoreStock(analysisMap[s.sym.replace(/\./g, '_')]),
    }))
    .sort((a, b) => b.score - a.score);

  const buySignals = rankedStocks.filter(s => s.recommendation === 'BUY');
  const topPick    = buySignals[0] || null;

  const report = {
    asOf: new Date().toISOString(),
    rankedStocks,
    buySignals,
    topPick,
  };

  const errors = [];
  let twilioDebug = null;

  // --- Step 5: Send email via Resend ---
  const resendKey   = process.env.RESEND_API_KEY;
  const fromEmail   = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
  const toEmail     = process.env.REPORT_EMAIL || 'atamertarslan@gmail.com';

  if (resendKey) {
    const subject = topPick
      ? `StockPulse Daily: ${buySignals.length} BUY Signal${buySignals.length !== 1 ? 's' : ''} — Top Pick: ${topPick.label}`
      : `StockPulse Daily: No BUY Signals Today`;

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:    `StockPulse <${fromEmail}>`,
        to:      [toEmail],
        subject,
        html:    buildEmailHtml(report),
        text:    buildEmailText(report),
      }),
    });
    if (!emailRes.ok) {
      const err = await emailRes.text();
      errors.push(`Email failed (${emailRes.status}): ${err.slice(0, 200)}`);
    }
  } else {
    errors.push('RESEND_API_KEY not set — email skipped');
  }

  // --- Step 6: Send WhatsApp via Twilio ---
  const twilioSid   = process.env.TWILIO_ACCOUNT_SID;
  const twilioToken = process.env.TWILIO_AUTH_TOKEN;
  const fromWA      = process.env.TWILIO_FROM_WHATSAPP;
  const toWA        = process.env.REPORT_PHONE;

  if (twilioSid && twilioToken && fromWA && toWA) {
    const twilioAuth = Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64');
    const waRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization:  `Basic ${twilioAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          From: `whatsapp:${fromWA}`,
          To:   `whatsapp:${toWA}`,
          Body: buildWhatsAppText(report),
        }),
      }
    );
    const waBody = await waRes.json().catch(() => ({}));
    if (!waRes.ok) {
      errors.push(`WhatsApp failed (${waRes.status}): ${JSON.stringify(waBody).slice(0, 200)}`);
    }
    twilioDebug = { sid: waBody.sid, status: waBody.status, errorCode: waBody.error_code, errorMessage: waBody.error_message };
  } else {
    errors.push('Twilio env vars not set — WhatsApp skipped');
  }

  res.setHeader('Content-Type', 'application/json').status(200).json({
    ok: errors.length === 0,
    buySignals: buySignals.length,
    totalAnalyzed: rankedStocks.length,
    topPick: topPick?.label || null,
    asOf: report.asOf,
    errors: errors.length > 0 ? errors : undefined,
    twilioDebug: twilioDebug || undefined,
  });
}
