/**
 * Transactional emails for Ladipo marketplace orders.
 */

import { sendEmail } from './email.service.js';

const frontendBase = () => process.env.FRONTEND_URL || 'https://app.motoka.ng';

function formatNairaFromKobo(kobo) {
  const n = Number(kobo);
  if (!Number.isFinite(n)) return '—';
  return `₦${(n / 100).toLocaleString('en-NG')}`;
}

function itemsSummary(items) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return 'Your parts order';
  return list
    .slice(0, 5)
    .map((line) => `${line.name || 'Item'}${line.quantity > 1 ? ` ×${line.quantity}` : ''}`)
    .join(', ');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function itemLabel(line) {
  const name = String(line?.name || 'Item').trim() || 'Item';
  const qty = Number(line?.quantity || 0);
  return `${name}${qty > 1 ? ` ×${qty}` : ''}`;
}

function itemListHtml(items) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) {
    return '<p style="color:#6b7280;font-size:14px;line-height:1.5;margin:0 0 20px;">Items: Your parts order</p>';
  }
  const rows = list
    .slice(0, 20)
    .map((line) => `<li style="margin:0 0 6px;">${escapeHtml(itemLabel(line))}</li>`)
    .join('');
  return `
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;margin:0 0 20px;">
      <p style="color:#111827;font-size:13px;font-weight:700;letter-spacing:.01em;margin:0 0 10px;">Items in this order</p>
      <ul style="margin:0;padding-left:18px;color:#374151;font-size:14px;line-height:1.5;">
        ${rows}
      </ul>
    </div>`;
}

function itemListText(items) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return 'Items: Your parts order';
  return ['Items:', ...list.slice(0, 20).map((line) => `- ${itemLabel(line)}`)].join('\n');
}

/**
 * @param {Object} options
 * @param {string} options.to
 * @param {string} [options.firstName]
 * @param {Object} options.order - ladipo_orders row
 */
export async function sendLadipoOrderCreatedEmail({ to, firstName, order }) {
  const subject = `Ladipo order ${order.order_number} — complete payment`;
  const total = formatNairaFromKobo(order.total_kobo);
  const summary = itemsSummary(order.items);
  const safeName = escapeHtml(firstName || 'there');
  const safeSummary = escapeHtml(summary);
  const settingsUrl = `${frontendBase()}/settings`;

  const html = `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f4f4;margin:0;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e7eb;">
    <h1 style="font-size:20px;color:#05243F;margin:0 0 12px;">Order received</h1>
    <p style="color:#374151;line-height:1.6;margin:0 0 16px;">Hi ${safeName},</p>
    <p style="color:#374151;line-height:1.6;margin:0 0 16px;">
      We've created your Ladipo marketplace order <strong>${order.order_number}</strong>.
      Total: <strong>${total}</strong>.
    </p>
    <p style="color:#6b7280;font-size:14px;line-height:1.5;margin:0 0 20px;">${safeSummary}</p>
    <p style="color:#374151;line-height:1.6;margin:0 0 20px;">Complete payment in the app to confirm your order. You can review this order anytime under <strong>Settings → Payment &amp; Billing → My Orders</strong>.</p>
    <a href="${settingsUrl}" style="display:inline-block;background:#2389E3;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600;font-size:14px;">Open settings</a>
  </div>
</body></html>`;

  const text = [
    `Hi ${firstName || 'there'},`,
    '',
    `Your Ladipo order ${order.order_number} was created. Total: ${total}.`,
    summary,
    '',
    `Complete payment in the app. View orders: ${settingsUrl}`,
  ].join('\n');

  return sendEmail({ to, subject, html, text });
}

export async function sendLadipoPaymentSuccessEmail({ to, firstName, order }) {
  const subject = `Payment received — Ladipo order ${order.order_number}`;
  const total = formatNairaFromKobo(order.total_kobo);
  const summary = itemsSummary(order.items);
  const safeName = escapeHtml(firstName || 'there');
  const safeSummary = escapeHtml(summary);
  const settingsUrl = `${frontendBase()}/settings`;

  const html = `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f4f4;margin:0;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e7eb;">
    <h1 style="font-size:20px;color:#05243F;margin:0 0 12px;">Payment successful</h1>
    <p style="color:#374151;line-height:1.6;margin:0 0 16px;">Hi ${safeName},</p>
    <p style="color:#374151;line-height:1.6;margin:0 0 16px;">
      We've received your payment for <strong>${order.order_number}</strong> (${total}). Your parts order is being processed.
    </p>
    <p style="color:#6b7280;font-size:14px;line-height:1.5;margin:0 0 20px;">${safeSummary}</p>
    <p style="color:#374151;line-height:1.6;margin:0 0 20px;">We'll keep you updated as your order moves along. Order history: <a href="${settingsUrl}" style="color:#2389E3;">Settings → My Orders</a>.</p>
  </div>
</body></html>`;

  const text = [
    `Hi ${firstName || 'there'},`,
    '',
    `Payment confirmed for Ladipo order ${order.order_number}. Total: ${total}.`,
    summary,
    '',
    `We're processing your order. View orders: ${settingsUrl}`,
  ].join('\n');

  return sendEmail({ to, subject, html, text });
}

export async function sendLadipoPaymentFailedEmail({ to, firstName, order, reasonLabel }) {
  const subject = `Payment issue — Ladipo order ${order.order_number}`;
  const settingsUrl = `${frontendBase()}/settings`;
  const safeName = escapeHtml(firstName || 'there');
  const extra = reasonLabel ? ` (${reasonLabel})` : '';

  const html = `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f4f4;margin:0;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e7eb;">
    <h1 style="font-size:20px;color:#991b1b;margin:0 0 12px;">Payment not completed</h1>
    <p style="color:#374151;line-height:1.6;margin:0 0 16px;">Hi ${safeName},</p>
    <p style="color:#374151;line-height:1.6;margin:0 0 16px;">
      We couldn't confirm payment for Ladipo order <strong>${order.order_number}</strong>${extra}.
      You can start a new checkout from the Ladipo marketplace when you're ready.
    </p>
    <a href="${settingsUrl}" style="display:inline-block;background:#2389E3;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600;font-size:14px;">Account &amp; orders</a>
  </div>
</body></html>`;

  const text = [
    `Hi ${firstName || 'there'},`,
    '',
    `Payment for Ladipo order ${order.order_number} was not completed${extra}.`,
    `You can try again from the marketplace. ${settingsUrl}`,
  ].join('\n');

  return sendEmail({ to, subject, html, text });
}

export async function sendLadipoOrderProcessingEmail({ to, firstName, order }) {
  const subject = `Your Ladipo order ${order.order_number} is being processed`;
  const settingsUrl = `${frontendBase()}/settings`;
  const safeName = escapeHtml(firstName || 'there');

  const html = `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f4f4;margin:0;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e7eb;">
    <h1 style="font-size:20px;color:#05243F;margin:0 0 12px;">Order update</h1>
    <p style="color:#374151;line-height:1.6;margin:0 0 16px;">Hi ${safeName},</p>
    <p style="color:#374151;line-height:1.6;margin:0 0 16px;">
      Your Ladipo order <strong>${order.order_number}</strong> is now being processed by our team.
    </p>
    <p style="color:#374151;line-height:1.6;margin:0 0 20px;">We'll notify you once it is out for delivery.</p>
    <a href="${settingsUrl}" style="display:inline-block;background:#2389E3;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600;font-size:14px;">Track order</a>
  </div>
</body></html>`;

  const text = [
    `Hi ${firstName || 'there'},`,
    '',
    `Your Ladipo order ${order.order_number} is now being processed by our team.`,
    `We'll notify you once it is out for delivery.`,
    '',
    `Track order: ${settingsUrl}`,
  ].join('\n');

  return sendEmail({ to, subject, html, text });
}

export async function sendLadipoOutForDeliveryEmail({ to, firstName, order }) {
  const isPickup = String(order?.delivery?.method || '').toLowerCase() === 'pickup';
  const subject = isPickup
    ? `Your Ladipo order ${order.order_number} is ready for pickup`
    : `Your Ladipo order ${order.order_number} is out for delivery`;
  const settingsUrl = `${frontendBase()}/settings`;
  const safeName = escapeHtml(firstName || 'there');
  const heading = isPickup ? 'Ready for pickup' : 'Out for delivery';
  const bodyLine = isPickup
    ? `Great news. Your Ladipo order <strong>${order.order_number}</strong> is ready for pickup.`
    : `Great news. Your Ladipo order <strong>${order.order_number}</strong> is now out for delivery.`;
  const helperLine = isPickup
    ? 'Please come with your order number and a reachable phone number when picking up.'
    : 'Please keep your phone available so the rider can reach you easily.';
  const itemsHtml = itemListHtml(order.items);
  const itemsText = itemListText(order.items);

  const html = `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f4f4;margin:0;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e7eb;">
    <h1 style="font-size:20px;color:#05243F;margin:0 0 12px;">${heading}</h1>
    <p style="color:#374151;line-height:1.6;margin:0 0 16px;">Hi ${safeName},</p>
    <p style="color:#374151;line-height:1.6;margin:0 0 16px;">
      ${bodyLine}
    </p>
    ${itemsHtml}
    <p style="color:#374151;line-height:1.6;margin:0 0 20px;">${helperLine}</p>
    <a href="${settingsUrl}" style="display:inline-block;background:#2389E3;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600;font-size:14px;">Track order</a>
  </div>
</body></html>`;

  const text = [
    `Hi ${firstName || 'there'},`,
    '',
    isPickup
      ? `Your Ladipo order ${order.order_number} is ready for pickup.`
      : `Your Ladipo order ${order.order_number} is now out for delivery.`,
    isPickup
      ? 'Please come with your order number when picking up.'
      : 'Please keep your phone available for rider contact.',
    '',
    itemsText,
    '',
    `Track order: ${settingsUrl}`,
  ].join('\n');

  return sendEmail({ to, subject, html, text });
}

export async function sendLadipoDeliveredEmail({ to, firstName, order }) {
  const subject = `Delivered: Ladipo order ${order.order_number}`;
  const total = formatNairaFromKobo(order.total_kobo);
  const summary = itemsSummary(order.items);
  const safeName = escapeHtml(firstName || 'there');
  const safeSummary = escapeHtml(summary);
  const settingsUrl = `${frontendBase()}/settings`;

  const html = `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f4f4;margin:0;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e7eb;">
    <h1 style="font-size:20px;color:#05243F;margin:0 0 12px;">Order delivered</h1>
    <p style="color:#374151;line-height:1.6;margin:0 0 16px;">Hi ${safeName},</p>
    <p style="color:#374151;line-height:1.6;margin:0 0 16px;">
      Your Ladipo order <strong>${order.order_number}</strong> has been delivered successfully.
    </p>
    <p style="color:#6b7280;font-size:14px;line-height:1.5;margin:0 0 16px;">${safeSummary}</p>
    <p style="color:#374151;line-height:1.6;margin:0 0 20px;">Total paid: <strong>${total}</strong>. Thank you for using Motoka.</p>
    <a href="${settingsUrl}" style="display:inline-block;background:#2389E3;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600;font-size:14px;">View order history</a>
  </div>
</body></html>`;

  const text = [
    `Hi ${firstName || 'there'},`,
    '',
    `Your Ladipo order ${order.order_number} has been delivered successfully.`,
    `Total paid: ${total}.`,
    summary,
    '',
    `View order history: ${settingsUrl}`,
  ].join('\n');

  return sendEmail({ to, subject, html, text });
}

export async function sendLadipoCancelledEmail({ to, firstName, order, reason }) {
  const subject = `Order cancelled: Ladipo order ${order.order_number}`;
  const settingsUrl = `${frontendBase()}/settings`;
  const safeName = escapeHtml(firstName || 'there');
  const safeReason = escapeHtml(String(reason || '').trim());

  const html = `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f4f4;margin:0;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e7eb;">
    <h1 style="font-size:20px;color:#991b1b;margin:0 0 12px;">Order cancelled</h1>
    <p style="color:#374151;line-height:1.6;margin:0 0 16px;">Hi ${safeName},</p>
    <p style="color:#374151;line-height:1.6;margin:0 0 16px;">
      Your Ladipo order <strong>${order.order_number}</strong> has been cancelled by our team.
    </p>
    <p style="color:#374151;line-height:1.6;margin:0 0 20px;">
      <strong>Reason:</strong> ${safeReason || 'No reason provided.'}
    </p>
    <a href="${settingsUrl}" style="display:inline-block;background:#2389E3;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600;font-size:14px;">Contact support</a>
  </div>
</body></html>`;

  const text = [
    `Hi ${firstName || 'there'},`,
    '',
    `Your Ladipo order ${order.order_number} has been cancelled.`,
    `Reason: ${safeReason || 'No reason provided.'}`,
    '',
    `If you need help, visit: ${settingsUrl}`,
  ].join('\n');

  return sendEmail({ to, subject, html, text });
}
