/**
 * FACEBOOK ESCALATION SERVICE
 *
 * Notifies the owner when the bot cannot answer. Email is the primary
 * channel — Resend is already wired and needs no template approval, unlike
 * WhatsApp which requires a pre-approved Content Template for any
 * business-initiated message.
 *
 * Recipients come from FACEBOOK_ESCALATION_EMAILS (comma-separated).
 * Unset means the feature is off — the conversation still flips to human
 * mode in the database, but nobody gets pinged. Safe default: no spam if
 * the env var is forgotten.
 *
 * Every send is fire-and-forget: an alert failure must never block the
 * holding message already sent to the customer.
 */

import { sendEmail } from '../email/email.service.js';
import { logError, logInfo } from '../../utils/logger.js';

function recipients() {
  return String(process.env.FACEBOOK_ESCALATION_EMAILS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const esc = (value) =>
  String(value ?? '—')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function row(label, value) {
  return `
    <tr>
      <td style="padding:8px 0;color:#56687f;font-size:13px;width:140px;vertical-align:top;">${esc(label)}</td>
      <td style="padding:8px 0;color:#0a1a2b;font-size:14px;font-weight:600;">${esc(value)}</td>
    </tr>`;
}

/**
 * Send the escalation alert.
 *
 * @param {Object} opts
 * @param {string} opts.channel     - 'messenger' | 'instagram'
 * @param {string} opts.psid        - Page-scoped id (opaque, for reference)
 * @param {string} opts.customerName - Best-effort display name from Meta
 * @param {string} opts.customerMessage - What they actually asked
 * @param {string} opts.reason      - Why the bot escalated
 * @param {Array}  opts.recentHistory - Last few turns for context
 */
export async function sendEscalationAlert({
  channel,
  psid,
  customerName,
  customerMessage,
  reason,
  recentHistory = [],
}) {
  const to = recipients();
  if (to.length === 0) {
    logInfo('[FacebookEscalation] No recipients configured — skipping alert', { psid });
    return { skipped: true };
  }

  try {
    const historyHtml = recentHistory
      .slice(-6)
      .map(
        (m) =>
          `<p style="margin:4px 0;font-size:13px;color:${m.role === 'user' ? '#0a1a2b' : '#56687f'};">
            <strong>${m.role === 'user' ? esc(customerName || 'Customer') : 'Mo'}:</strong> ${esc(m.content)}
          </p>`
      )
      .join('');

    const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f1f4fb;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #d2dae8;border-radius:12px;overflow:hidden;">
    <div style="padding:20px 24px;border-bottom:1px solid #e3e9f3;">
      <span style="display:inline-block;padding:3px 9px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;background:#dc2626;color:#ffffff;">Escalation</span>
      <h1 style="margin:10px 0 0;font-size:19px;color:#05243f;">Mo needs you on a ${esc(channel)} thread</h1>
    </div>
    <div style="padding:8px 24px 20px;">
      <table style="width:100%;border-collapse:collapse;">
        ${row('Channel', channel)}
        ${row('Customer', customerName || 'Unknown')}
        ${row('Reason', reason)}
      </table>
    </div>
    <div style="padding:0 24px 16px;">
      <p style="margin:0 0 6px;font-size:13px;color:#56687f;font-weight:600;">Their message</p>
      <p style="margin:0;padding:12px 14px;background:#f8fafc;border:1px solid #e3e9f3;border-radius:8px;font-size:14px;color:#0a1a2b;">${esc(customerMessage)}</p>
    </div>
    ${historyHtml ? `<div style="padding:0 24px 20px;"><p style="margin:0 0 6px;font-size:13px;color:#56687f;font-weight:600;">Recent turns</p>${historyHtml}</div>` : ''}
    <div style="padding:0 24px 24px;">
      <a href="https://www.facebook.com/messages/t/${esc(psid)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:8px;">Reply on Messenger</a>
    </div>
  </div>
  <p style="max-width:560px;margin:14px auto 0;color:#56687f;font-size:12px;">
    Automated alert from Motoka. Manage recipients with FACEBOOK_ESCALATION_EMAILS.
  </p>
</body></html>`;

    const subject = `Mo escalation — ${customerName || 'Unknown'} on ${channel}`;

    const results = await Promise.allSettled(
      to.map((address) => sendEmail({ to: address, subject, html }))
    );

    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        logError('[FacebookEscalation] Send failed', {
          to: to[i],
          error: result.reason?.message,
        });
      }
    });

    const delivered = results.filter((r) => r.status === 'fulfilled').length;
    logInfo('[FacebookEscalation] Dispatched', { subject, delivered, attempted: to.length });
    return { delivered, attempted: to.length };
  } catch (err) {
    logError('[FacebookEscalation] Alert failed', { psid, error: err.message });
    return { delivered: 0, attempted: to.length, error: err.message };
  }
}
