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
  const subject = '🎉 Welcome to Motoka!';
  const userGreeting = firstName ? `Hi ${firstName}` : 'Hello';

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          margin: 0;
          padding: 0;
          background-color: #f4f4f4;
        }
        .container {
          max-width: 600px;
          margin: 0 auto;
          background-color: #ffffff;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }
        .header {
          background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
          color: #ffffff;
          padding: 40px 30px;
          text-align: center;
        }
        .header h1 {
          margin: 0;
          font-size: 28px;
          font-weight: 700;
          letter-spacing: -0.5px;
        }
        .emoji {
          font-size: 32px;
          margin-right: 10px;
        }
        .content {
          padding: 40px 30px;
        }
        .greeting {
          font-size: 16px;
          line-height: 1.6;
          color: #333333;
          margin: 0 0 20px 0;
        }
        .message {
          font-size: 15px;
          line-height: 1.6;
          color: #555555;
          margin: 15px 0;
        }
        .car-details-box {
          background-color: #f8f9fa;
          border: 2px solid #e9ecef;
          border-radius: 8px;
          padding: 20px;
          margin: 25px 0;
        }
        .car-details-title {
          font-size: 14px;
          font-weight: 600;
          color: #1a1a1a;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 15px;
        }
        .car-detail-row {
          display: flex;
          justify-content: space-between;
          padding: 10px 0;
          border-bottom: 1px solid #e0e0e0;
          font-size: 14px;
        }
        .car-detail-row:last-child {
          border-bottom: none;
        }
        .car-detail-label {
          font-weight: 600;
          color: #666666;
        }
        .car-detail-value {
          color: #1a1a1a;
          font-weight: 500;
        }
        .cta-button {
          display: inline-block;
          background-color: #1a1a1a;
          color: #ffffff;
          padding: 12px 30px;
          text-decoration: none;
          border-radius: 6px;
          font-weight: 600;
          margin: 25px 0;
          font-size: 14px;
        }
        .cta-button:hover {
          background-color: #2d2d2d;
        }
        .footer {
          background-color: #f8f9fa;
          padding: 25px 30px;
          text-align: center;
          font-size: 12px;
          color: #6c757d;
          border-top: 1px solid #e0e0e0;
        }
        .footer p {
          margin: 5px 0;
        }
        .celebration-text {
          font-size: 14px;
          color: #1a1a1a;
          font-weight: 600;
          margin: 20px 0;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1><span class="emoji">🎉</span>Welcome to Motoka</h1>
        </div>
        <div class="content">
          <p class="greeting"><strong>${userGreeting},</strong></p>
          
          <p class="message">
            Thanks for registering your first car with us! We're excited to have you on board. 
            Your vehicle is now registered in our system, and you're all set to manage your car with Motoka.
          </p>

          <div class="car-details-box">
            <div class="car-details-title">📋 Your Registered Vehicle</div>
            <div class="car-detail-row">
              <span class="car-detail-label">Make & Model</span>
              <span class="car-detail-value">${carDetails.make} ${carDetails.model}</span>
            </div>
            <div class="car-detail-row">
              <span class="car-detail-label">Registration Number</span>
              <span class="car-detail-value">${carDetails.registration_no}</span>
            </div>
          </div>

          <p class="celebration-text">
            ✨ You're all set! Your first car is now registered with Motoka.
          </p>

          <p class="message">
            Next steps:
            <ul style="color: #555555; line-height: 1.8;">
              <li>Complete your vehicle registration approval process</li>
              <li>Keep track of your vehicle's renewal dates</li>
              <li>Access all your vehicle documents in one place</li>
              <li>Get timely renewal reminders before expiry</li>
            </ul>
          </p>

          <p class="message">
            If you have any questions or need assistance, our support team is always here to help.
          </p>
        </div>
        <div class="footer">
          <p>© ${new Date().getFullYear()} Motoka. All rights reserved.</p>
          <p>This is an automated message, please do not reply.</p>
          <p><em>Motoka - Your Complete Vehicle Management Solution</em></p>
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `
Welcome to Motoka!

${userGreeting},

Thanks for registering your first car with us! We're excited to have you on board.

Your Registered Vehicle:
Make & Model: ${carDetails.make} ${carDetails.model}
Registration Number: ${carDetails.registration_no}

Next steps:
- Complete your vehicle registration approval process
- Keep track of your vehicle's renewal dates
- Access all your vehicle documents in one place
- Get timely renewal reminders before expiry

If you have any questions or need assistance, our support team is always here to help.

© ${new Date().getFullYear()} Motoka. All rights reserved.
  `.trim();

  return await sendEmail({ to, subject, html, text });
}
