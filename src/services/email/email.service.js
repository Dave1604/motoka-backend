import { config } from 'dotenv';
import { Resend } from 'resend';

// Ensure environment variables are loaded before using RESEND_API_KEY.
// This is needed because ESM import order can run this module before
// dotenv is configured in src/index.js.
config();

/**
 * EMAIL SERVICE - Resend Integration
 *
 * Centralized email sending using Resend API.
 * Replaces Brevo for backend-generated emails (password reset, 2FA).
 *
 * Supabase Auth emails (login OTP, signup verification) remain unchanged
 * and continue using SMTP configured in Supabase dashboard.
 *
 * Environment Variables Required:
 * - RESEND_API_KEY: Your Resend API key (starts with re_)
 * - EMAIL_FROM: Sender email (e.g., "Motoka <no-reply@motokaapp.ng>")
 */

// Lazy-load Resend instance to ensure env vars are loaded first
let resendInstance = null;
function getResend() {
  if (!resendInstance) {
    if (!process.env.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY not configured');
    }
    resendInstance = new Resend(process.env.RESEND_API_KEY);
  }
  return resendInstance;
}

const EMAIL_FROM = process.env.EMAIL_FROM || 'Motoka <onboarding@resend.dev>';

function buildResendTroubleshootingHint(errorMessage = '') {
  const msg = String(errorMessage || '').toLowerCase();

  if (msg.includes('application not found')) {
    return 'Resend application/key mismatch. Generate a fresh API key from the same Resend workspace/project and update RESEND_API_KEY.';
  }

  if (msg.includes('invalid api key') || msg.includes('unauthorized') || msg.includes('forbidden')) {
    return 'Resend API key is invalid or revoked. Replace RESEND_API_KEY with an active key.';
  }

  if (msg.includes('domain') || msg.includes('from')) {
    return 'Sender/domain issue. Verify EMAIL_FROM domain in Resend or use onboarding@resend.dev for testing.';
  }

  return null;
}

/**
 * Generic email sender
 *
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email
 * @param {string} options.subject - Email subject
 * @param {string} options.html - HTML content
 * @param {string} [options.text] - Plain text content (optional)
 * @returns {Promise<Object>} Resend response
 */
export async function sendEmail({ to, subject, html, text }) {
  try {
    const resend = getResend();

    const { data, error } = await resend.emails.send({
      from: EMAIL_FROM,
      to,
      subject,
      html,
      text: text || undefined // Only include if provided
    });

    if (error) {
      const hint = buildResendTroubleshootingHint(error.message);
      console.error('[Email Service] Send failed:', {
        to,
        subject,
        from: EMAIL_FROM,
        error: error.message,
        hint
      });
      throw new Error(
        hint
          ? `Email send failed: ${error.message}. ${hint}`
          : `Email send failed: ${error.message}`
      );
    }

    console.log('[Email Service] Email sent successfully:', { to, subject, id: data?.id });
    return { success: true, id: data?.id };
  } catch (error) {
    console.error('[Email Service] Exception:', error.message);
    throw error;
  }
}

// ─── SHARED SHELL ────────────────────────────────────────────────────────────

// PNG/JPG only — SVG is blocked by all major email clients
const LOGO_URL = process.env.EMAIL_LOGO_URL || 'https://motoka-logo.vercel.app/Logo.png';
const isPngLogo = LOGO_URL && /\.(png|jpg|jpeg|webp)$/i.test(LOGO_URL);

/**
 * Minimal branded email shell used by all transactional emails.
 * @param {string} content - Inner HTML content
 */
function buildEmailShell(content) {
  const year = new Date().getFullYear();
  const brandMark = isPngLogo
    ? `<img src="${LOGO_URL}" alt="Motoka" width="120" height="32" style="display:block;border:0;height:32px;width:auto" />`
    : `<span style="font-size:22px;font-weight:800;color:#1B6DBD;letter-spacing:-0.5px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">motoka</span>`;

  return `<!DOCTYPE html>
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
    .body{padding:32px 36px 28px}
    .title{font-size:20px;font-weight:700;color:#111827;margin-bottom:6px;letter-spacing:-0.3px}
    .sub{font-size:13.5px;color:#6b7280;margin-bottom:26px;line-height:1.55}
    .code-wrap{background:#f5f9ff;border:1px solid #c9dff5;border-radius:10px;padding:22px 20px;text-align:center;margin-bottom:20px}
    .code{font-size:38px;font-weight:800;color:#1B6DBD;letter-spacing:10px;font-family:'Courier New',monospace}
    .expires{font-size:12px;color:#9ca3af;margin-top:8px}
    .alert{font-size:12.5px;color:#92400e;background:#fffbeb;border-left:3px solid #f59e0b;padding:10px 14px;border-radius:0 6px 6px 0;margin-bottom:18px;line-height:1.5}
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
    <div class="body">${content}</div>
    <div class="footer"><p>&copy; ${year} Motoka &mdash; Automated message, do not reply.</p></div>
  </div>
</body>
</html>`;
}

// ─── PASSWORD RESET ───────────────────────────────────────────────────────────

/**
 * Send password reset OTP email
 *
 * SECURITY: Never log the OTP value
 *
 * @param {Object} options
 * @param {string} options.to - Recipient email
 * @param {string} options.otp - 6-digit OTP code
 * @returns {Promise<Object>} Send result
 */
export async function sendPasswordResetOTP({ to, otp }) {
  const subject = 'Reset Your Motoka Password';

  const content = `
    <p class="title">Password Reset</p>
    <p class="sub">Use the code below to reset your Motoka password.</p>
    <div class="code-wrap">
      <div class="code">${otp}</div>
      <div class="expires">Expires in 15 minutes</div>
    </div>
    <p class="alert">Never share this code — Motoka will never ask for it.</p>
    <p class="note">Didn't request this? You can safely ignore this email.</p>
  `;

  const html = buildEmailShell(content);

  const text = `
Motoka Password Reset

You requested to reset your password.

Your verification code is: ${otp}

This code will expire in 15 minutes.

If you didn't request this, you can safely ignore this email.

Never share this code with anyone. Motoka support will never ask for your OTP.

© ${new Date().getFullYear()} Motoka
  `.trim();

  return await sendEmail({ to, subject, html, text });
}

// ─── 2FA CODE ─────────────────────────────────────────────────────────────────

/**
 * Send 2FA email code
 *
 * SECURITY: Never log the code value
 *
 * @param {Object} options
 * @param {string} options.to - Recipient email
 * @param {string} options.code - 6-digit 2FA code
 * @returns {Promise<Object>} Send result
 */
export async function send2FACode({ to, code }) {
  const subject = 'Your Motoka Sign-in Code';

  const content = `
    <p class="title">Sign-in Verification</p>
    <p class="sub">Use the code below to complete your Motoka sign-in.</p>
    <div class="code-wrap">
      <div class="code">${code}</div>
      <div class="expires">Expires in 10 minutes</div>
    </div>
    <p class="alert">Never share this code — Motoka will never ask for it.</p>
    <p class="note">Didn't attempt to sign in? Change your password immediately.</p>
  `;

  const html = buildEmailShell(content);

  const text = `
Motoka Two-Factor Authentication

Your 2FA verification code is: ${code}

This code will expire in 10 minutes.

If you didn't attempt to sign in, please secure your account immediately.

Never share this code with anyone. Motoka support will never ask for your 2FA code.

© ${new Date().getFullYear()} Motoka
  `.trim();

  return await sendEmail({ to, subject, html, text });
}