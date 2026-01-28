import { Resend } from 'resend';

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

const resend = new Resend(process.env.RESEND_API_KEY);
const EMAIL_FROM = process.env.EMAIL_FROM || 'Motoka <onboarding@resend.dev>';

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
    if (!process.env.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY not configured');
    }

    const { data, error } = await resend.emails.send({
      from: EMAIL_FROM,
      to,
      subject,
      html,
      text: text || undefined // Only include if provided
    });

    if (error) {
      console.error('[Email Service] Send failed:', { to, subject, error: error.message });
      throw new Error(`Email send failed: ${error.message}`);
    }

    console.log('[Email Service] Email sent successfully:', { to, subject, id: data?.id });
    return { success: true, id: data?.id };
  } catch (error) {
    console.error('[Email Service] Exception:', error.message);
    throw error;
  }
}

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
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f4f4; }
        .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; }
        .header { background-color: #1a1a1a; color: #ffffff; padding: 30px 20px; text-align: center; }
        .content { padding: 40px 30px; }
        .otp-box { background-color: #f8f9fa; border: 2px solid #e9ecef; border-radius: 8px; padding: 20px; text-align: center; margin: 30px 0; }
        .otp-code { font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1a1a1a; font-family: monospace; }
        .footer { background-color: #f8f9fa; padding: 20px; text-align: center; font-size: 12px; color: #6c757d; }
        .warning { color: #dc3545; font-weight: 500; margin-top: 20px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Password Reset Request</h1>
        </div>
        <div class="content">
          <p>Hello,</p>
          <p>You requested to reset your Motoka password. Use the code below to complete the process:</p>
          
          <div class="otp-box">
            <div class="otp-code">${otp}</div>
          </div>
          
          <p><strong>This code will expire in 15 minutes.</strong></p>
          
          <p>If you didn't request this password reset, you can safely ignore this email. Your password will remain unchanged.</p>
          
          <p class="warning">⚠️ Never share this code with anyone. Motoka support will never ask for your OTP.</p>
        </div>
        <div class="footer">
          <p>© ${new Date().getFullYear()} Motoka. All rights reserved.</p>
          <p>This is an automated message, please do not reply.</p>
        </div>
      </div>
    </body>
    </html>
  `;
  
  const text = `
Motoka Password Reset

You requested to reset your password.

Your verification code is: ${otp}

This code will expire in 15 minutes.

If you didn't request this, you can safely ignore this email.

Never share this code with anyone.

© ${new Date().getFullYear()} Motoka
  `.trim();

  return await sendEmail({ to, subject, html, text });
}

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
  const subject = 'Your Motoka 2FA Code';
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f4f4; }
        .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; }
        .header { background-color: #1a1a1a; color: #ffffff; padding: 30px 20px; text-align: center; }
        .content { padding: 40px 30px; }
        .code-box { background-color: #f8f9fa; border: 2px solid #e9ecef; border-radius: 8px; padding: 20px; text-align: center; margin: 30px 0; }
        .code { font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1a1a1a; font-family: monospace; }
        .footer { background-color: #f8f9fa; padding: 20px; text-align: center; font-size: 12px; color: #6c757d; }
        .warning { color: #dc3545; font-weight: 500; margin-top: 20px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Two-Factor Authentication</h1>
        </div>
        <div class="content">
          <p>Hello,</p>
          <p>Your two-factor authentication code is:</p>
          
          <div class="code-box">
            <div class="code">${code}</div>
          </div>
          
          <p><strong>This code will expire in 10 minutes.</strong></p>
          
          <p>If you didn't attempt to sign in, please secure your account immediately by changing your password.</p>
          
          <p class="warning">⚠️ Never share this code with anyone. Motoka support will never ask for your 2FA code.</p>
        </div>
        <div class="footer">
          <p>© ${new Date().getFullYear()} Motoka. All rights reserved.</p>
          <p>This is an automated message, please do not reply.</p>
        </div>
      </div>
    </body>
    </html>
  `;
  
  const text = `
Motoka Two-Factor Authentication

Your 2FA verification code is: ${code}

This code will expire in 10 minutes.

If you didn't attempt to sign in, please secure your account immediately.

Never share this code with anyone.

© ${new Date().getFullYear()} Motoka
  `.trim();

  return await sendEmail({ to, subject, html, text });
}
