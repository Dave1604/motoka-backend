import { sendEmail } from '../email/email.service.js';
import { logError, logInfo } from '../../utils/logger.js';

/**
 * Operator alerts for the agent payout pipeline. Same posture as the Facebook
 * escalation alerts: Resend is already wired, needs no template approval, and a
 * failure to alert must never block the payout itself.
 *
 * Recipients come from AGENT_PAYOUT_ALERT_EMAILS (comma-separated). Unset means
 * alerts are off and the pipeline keeps running — safe default, no spam if the
 * env var is forgotten.
 */
function recipients() {
  return String(process.env.AGENT_PAYOUT_ALERT_EMAILS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const esc = (v) =>
  String(v ?? '—')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const TITLES = {
  manual_review: 'Agent payout held — needs you',
  failed: 'Agent payout FAILED',
};

const KIND_COPY = {
  manual_review:
    'A paid order was assigned to an agent, but the automatic transfer was withheld. It is sitting in the Payouts queue as <strong>Manual review</strong>.',
  failed:
    'An automatic agent payout failed after the transfer was attempted. It is sitting in the Payouts queue as <strong>Failed</strong> and can be retried.',
};

/**
 * @param {Object} opts
 * @param {'manual_review'|'failed'} opts.kind
 * @param {Object} opts.payout - agent_payouts row
 * @param {Object} [opts.agent] - agents row (optional; read from payout if absent)
 * @param {Object} [opts.cost]  - computeOrderCost result, for the line breakdown
 */
export async function sendPayoutAlert({ kind, payout, agent, cost }) {
  const to = recipients();
  if (to.length === 0) {
    logInfo('[AgentPayoutAlert] No recipients configured — skipping', { kind, payoutId: payout?.id });
    return { skipped: true };
  }
  if (!TITLES[kind]) return { skipped: true, reason: `unknown_kind:${kind}` };

  try {
    const orderRef =
      payout.order_type === 'regular' ? `ORD id ${payout.regular_order_id}` : `Guest order ${payout.guest_order_id}`;
    const amount = `₦${(Number(payout.amount_kobo) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;

    const costRows = (cost?.costs || [])
      .map((c) => `<li style="margin:2px 0;">${esc(c.service_type)}:${esc(c.service_key)} — ₦${(c.cost_kobo / 100).toLocaleString('en-NG')}</li>`)
      .join('');
    const missingRows = (payout.missing_costs || [])
      .map((m) => `<li style="margin:2px 0;color:#b42318;">${esc(m.service_type)}:${esc(m.service_key)} — no cost set</li>`)
      .join('');

    const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f1f4fb;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px;">
    <h1 style="margin:0 0 4px;font-size:18px;color:#0a1a2b;">${TITLES[kind]}</h1>
    <p style="margin:0 0 20px;font-size:14px;color:#56687f;">${KIND_COPY[kind]}</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:8px 0;color:#56687f;width:150px;">Order</td><td style="color:#0a1a2b;font-weight:600;">${esc(orderRef)}</td></tr>
      <tr><td style="padding:8px 0;color:#56687f;">Agent</td><td style="color:#0a1a2b;font-weight:600;">${esc(agent?.name || payout.agent_id)}</td></tr>
      <tr><td style="padding:8px 0;color:#56687f;">Amount</td><td style="color:#0a1a2b;font-weight:600;">${amount}</td></tr>
      <tr><td style="padding:8px 0;color:#56687f;">Reason</td><td style="color:#b42318;font-weight:600;">${esc(payout.failure_reason || '—')}</td></tr>
      ${agent?.account_number ? `<tr><td style="padding:8px 0;color:#56687f;">Paying to</td><td style="color:#0a1a2b;">${esc(agent.account_name || '—')} · ${esc(agent.bank_name || '—')} · ${esc(agent.account_number)}</td></tr>` : ''}
    </table>
    ${costRows ? `<p style="margin:20px 0 4px;font-size:13px;color:#56687f;">Priced items</p><ul style="margin:0;padding-left:18px;font-size:13px;color:#0a1a2b;">${costRows}</ul>` : ''}
    ${missingRows ? `<p style="margin:16px 0 4px;font-size:13px;color:#b42318;">Missing costs</p><ul style="margin:0;padding-left:18px;font-size:13px;">${missingRows}</ul>` : ''}
    <p style="margin:24px 0 0;font-size:13px;color:#56687f;">Open the Payouts queue in the admin to ${kind === 'failed' ? 'retry or mark as paid' : 'set the missing costs and pay' }.</p>
  </div>
</body></html>`;

    await sendEmail({
      to,
      subject: `${TITLES[kind]} — ${orderRef}`,
      html,
    });
    logInfo('[AgentPayoutAlert] Sent', { kind, payoutId: payout.id });
    return { sent: true };
  } catch (err) {
    logError('[AgentPayoutAlert] Failed to send', { kind, payoutId: payout?.id, error: err.message });
    return { error: err.message };
  }
}
