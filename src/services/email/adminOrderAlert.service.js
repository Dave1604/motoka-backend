/**
 * ADMIN ORDER ALERTS
 *
 * Emails the ops inbox whenever a paid order lands, for both registered-user
 * orders and guest renewals. Recipients come from ADMIN_ORDER_ALERT_EMAILS
 * (comma-separated); unset means the feature is simply off.
 *
 * Every send is fire-and-forget: an alert failure must never roll back or
 * block a payment that already succeeded.
 */

import { sendEmail } from './email.service.js';
import { logError, logInfo } from '../../utils/logger.js';

const FRONTEND_ADMIN_BASE = () =>
  (process.env.ADMIN_APP_URL || process.env.FRONTEND_URL || 'https://app.motoka.ng').replace(/\/$/, '');

function recipients() {
  return String(process.env.ADMIN_ORDER_ALERT_EMAILS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const naira = (kobo) => {
  const n = Number(kobo);
  if (!Number.isFinite(n)) return '—';
  return `₦${(n / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
};

const esc = (value) =>
  String(value ?? '—')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function row(label, value) {
  return `
    <tr>
      <td style="padding:8px 0;color:#56687f;font-size:13px;width:160px;vertical-align:top;">${esc(label)}</td>
      <td style="padding:8px 0;color:#0a1a2b;font-size:14px;font-weight:600;">${esc(value)}</td>
    </tr>`;
}

function template({ heading, badge, badgeColor, rows, actionUrl, actionLabel }) {
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f1f4fb;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #d2dae8;border-radius:12px;overflow:hidden;">
    <div style="padding:20px 24px;border-bottom:1px solid #e3e9f3;">
      <span style="display:inline-block;padding:3px 9px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;background:${badgeColor};color:#ffffff;">${esc(badge)}</span>
      <h1 style="margin:10px 0 0;font-size:19px;color:#05243f;">${esc(heading)}</h1>
    </div>
    <div style="padding:8px 24px 20px;">
      <table style="width:100%;border-collapse:collapse;">${rows}</table>
    </div>
    <div style="padding:0 24px 24px;">
      <a href="${esc(actionUrl)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:8px;">${esc(actionLabel)}</a>
    </div>
  </div>
  <p style="max-width:560px;margin:14px auto 0;color:#56687f;font-size:12px;">
    Automated alert from Motoka. Manage recipients with ADMIN_ORDER_ALERT_EMAILS.
  </p>
</body></html>`;
}

async function dispatch({ subject, html, text }) {
  const to = recipients();
  if (to.length === 0) return { skipped: true };

  // Sent individually so one bad address can't suppress everyone else's alert.
  const results = await Promise.allSettled(
    to.map((address) => sendEmail({ to: address, subject, html, text }))
  );

  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      logError('[AdminOrderAlert] Send failed', { to: to[i], subject, error: result.reason?.message });
    }
  });

  const delivered = results.filter((r) => r.status === 'fulfilled').length;
  logInfo('[AdminOrderAlert] Dispatched', { subject, delivered, attempted: to.length });
  return { delivered, attempted: to.length };
}

/**
 * Paid order from a registered user.
 * Amounts arrive in naira on this path (payment_transactions.amount).
 */
export async function sendAdminOrderAlert({
  orderNumber,
  customerName,
  customerEmail,
  amountNaira,
  reference,
  paymentType,
  documentNames,
  plateNumber,
}) {
  try {
    const url = `${FRONTEND_ADMIN_BASE()}/admin/orders`;
    const amount = Number.isFinite(Number(amountNaira))
      ? `₦${Number(amountNaira).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`
      : '—';

    const rows = [
      row('Order', orderNumber || 'Not yet assigned'),
      row('Customer', customerName),
      row('Email', customerEmail),
      row('Amount', amount),
      row('Type', paymentType),
      plateNumber ? row('Plate', plateNumber) : '',
      documentNames?.length ? row('Documents', documentNames.join(', ')) : '',
      row('Reference', reference),
    ].join('');

    const subject = `New order${orderNumber ? ` ${orderNumber}` : ''} — ${amount}`;

    return await dispatch({
      subject,
      html: template({
        heading: 'A new order was paid for',
        badge: 'User order',
        badgeColor: '#2563eb',
        rows,
        actionUrl: url,
        actionLabel: 'Open Orders',
      }),
      text: `New paid order.\nOrder: ${orderNumber || 'n/a'}\nCustomer: ${customerName} (${customerEmail})\nAmount: ${amount}\nReference: ${reference}\n${url}`,
    });
  } catch (error) {
    logError('[AdminOrderAlert] User order alert failed (non-fatal)', { error: error.message, reference });
    return { error: error.message };
  }
}

/**
 * Paid guest renewal. Guest amounts are stored in kobo.
 */
export async function sendAdminGuestOrderAlert({
  orderId,
  guestName,
  guestEmail,
  guestPhone,
  plateNumber,
  totalAmountKobo,
  deliveryFeeKobo,
  documentNames,
  reference,
}) {
  try {
    const url = `${FRONTEND_ADMIN_BASE()}/admin/guest-orders/${orderId}`;
    const amount = naira(totalAmountKobo);
    const wantsDelivery = Number(deliveryFeeKobo) > 0;

    const rows = [
      row('Guest', guestName),
      row('Email', guestEmail),
      row('Phone', guestPhone),
      row('Plate', plateNumber),
      row('Amount', amount),
      documentNames?.length ? row('Documents', documentNames.join(', ')) : '',
      row('Delivery', wantsDelivery ? `Yes — ${naira(deliveryFeeKobo)} paid` : 'No — pickup'),
      row('Reference', reference),
    ].join('');

    const subject = `New guest renewal — ${plateNumber || 'no plate'} · ${amount}`;

    return await dispatch({
      subject,
      html: template({
        heading: 'A guest paid for a renewal',
        badge: wantsDelivery ? 'Guest · delivery' : 'Guest order',
        badgeColor: wantsDelivery ? '#7c5a0e' : '#1f7a4d',
        rows,
        actionUrl: url,
        actionLabel: 'Open guest order',
      }),
      text: `New paid guest renewal.\nGuest: ${guestName} (${guestEmail}, ${guestPhone})\nPlate: ${plateNumber}\nAmount: ${amount}\nDelivery: ${wantsDelivery ? 'yes' : 'no'}\nReference: ${reference}\n${url}`,
    });
  } catch (error) {
    logError('[AdminOrderAlert] Guest order alert failed (non-fatal)', { error: error.message, orderId });
    return { error: error.message };
  }
}
