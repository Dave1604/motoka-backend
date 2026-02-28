import { sendEmail } from './email.service.js';

/**
 * CAR EMAIL SERVICE
 * 
 * Handles car-specific email notifications (welcome emails, approval notifications, etc.)
 */

/**
 * Send welcome notification email for first car registration
 * 
 * Sends an HTML-styled email with Motoka branding when a user registers their first car.
 * Includes car details (make, model, registration number) in the email.
 * 
 * @param {Object} options
 * @param {string} options.to - Recipient email
 * @param {string} options.firstName - User's first name (optional, for personalization)
 * @param {Object} options.carDetails - Car details object
 * @param {string} options.carDetails.make - Car make/manufacturer
 * @param {string} options.carDetails.model - Car model
 * @param {string} options.carDetails.registration_no - Car registration number
 * @returns {Promise<Object>} Send result
 */
export async function sendWelcomeEmail({ to, firstName, carDetails }) {
  const subject = 'Your car is registered on Motoka';
  const greeting = firstName ? `Hi ${firstName}` : 'Hello';
  // PNG/JPG only — SVG is blocked by all major email clients
  const logoUrl = process.env.EMAIL_LOGO_URL || 'https://motoka-logo.vercel.app/Logo.png';
  const isPngLogo = logoUrl && /\.(png|jpg|jpeg|webp)$/i.test(logoUrl);
  const brandMark = isPngLogo
    ? `<img src="${logoUrl}" alt="Motoka" width="120" height="32" style="display:block;border:0;height:32px;width:auto" />`
    : `<span style="font-size:22px;font-weight:800;color:#1B6DBD;letter-spacing:-0.5px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">motoka</span>`;
  const year = new Date().getFullYear();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Motoka</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#ffffff;color:#111827}
    .wrap{max-width:520px;margin:0 auto;background:#ffffff}
    .top-bar{height:4px;background:#1B6DBD}
    .brand{padding:22px 36px 18px;border-bottom:1px solid #e5eaf2}
    .brand img{height:26px;width:auto;display:block}
    .body{padding:32px 36px 28px}
    .title{font-size:20px;font-weight:700;color:#111827;margin-bottom:6px;letter-spacing:-0.3px}
    .sub{font-size:13.5px;color:#6b7280;margin-bottom:24px;line-height:1.55}
    table{width:100%;border-collapse:collapse;margin-bottom:24px}
    td{padding:11px 0;font-size:13.5px;border-bottom:1px solid #e5eaf2}
    tr:last-child td{border-bottom:none}
    .lbl{color:#6b7280;font-weight:500}
    .val{color:#111827;font-weight:600;text-align:right}
    .note{font-size:12.5px;color:#9ca3af;line-height:1.6}
    .footer{border-top:1px solid #e5eaf2;padding:14px 36px;text-align:center}
    .footer p{font-size:11px;color:#c0c8d4}
    @media(max-width:480px){.body{padding:24px 20px 20px}.brand{padding:18px 20px}.footer{padding:12px 20px}}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="top-bar"></div>
    <div class="brand">${brandMark}</div>
    <div class="body">
      <p class="title">${greeting}, your car is registered.</p>
      <p class="sub">Your vehicle is now live on Motoka and ready to manage.</p>
      <table>
        <tr><td class="lbl">Make &amp; Model</td><td class="val">${carDetails.make} ${carDetails.model}</td></tr>
        <tr><td class="lbl">Reg. Number</td><td class="val">${carDetails.registration_no}</td></tr>
      </table>
      <p class="note">You'll receive renewal reminders before your registration expires. Questions? <a href="mailto:support@motokaapp.ng" style="color:#1B6DBD;text-decoration:none">support@motokaapp.ng</a></p>
    </div>
    <div class="footer"><p>&copy; ${year} Motoka &mdash; Automated message, do not reply.</p></div>
  </div>
</body>
</html>`;

  const text = `
${greeting}, your car is registered on Motoka.

Make & Model: ${carDetails.make} ${carDetails.model}
Reg. Number:  ${carDetails.registration_no}

You'll receive renewal reminders before your registration expires.
Questions? support@motokaapp.ng

© ${year} Motoka. Automated message, do not reply.
  `.trim();

  return await sendEmail({ to, subject, html, text });
}
