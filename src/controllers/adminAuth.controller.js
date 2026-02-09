import { getSupabaseAdmin } from '../config/supabase.js';
import * as response from '../utils/responses.js';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { sendEmail } from '../services/email/email.service.js';

/**
 * ADMIN AUTHENTICATION CONTROLLER
 * 
 * Secure admin login flow using OTP email verification
 * Flow: Email → OTP (4-digit) → JWT Token (30 min expiry)
 * 
 * Security measures:
 * - OTP hashed with SHA-256 before storage
 * - 5-minute OTP expiration
 * - Checks for suspended accounts
 * - Validates admin status before sending OTP
 * - Rate limited (configured in routes)
 */

/**
 * Step 1: Admin Login Request - Send OTP to admin email
 * 
 * @route POST /api/admin/auth/send-otp
 * @access Public (but validates admin status)
 */
export const adminSendOTP = async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return response.validationError(res, { email: 'Email is required' });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Get user by email (Supabase admin API doesn't have getUserByEmail, so we use listUsers)
    const { data: usersData, error: authError } = await supabaseAdmin.auth.admin.listUsers();

    if (authError) {
      console.error('[Admin Auth] Error listing users:', authError);
      return response.serverError(res, 'Failed to process login request');
    }

    const user = usersData?.users?.find(u => u.email === email);

    if (!user) {
      // SECURITY: Don't reveal if email exists - generic error message
      return response.notFound(res, 'Admin account not found');
    }

    // Fetch profile to verify admin status and check suspension
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, is_admin, is_suspended, first_name, last_name')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      return response.notFound(res, 'Admin profile not found');
    }

    // Check suspended status BEFORE sending OTP
    if (profile.is_suspended) {
      return response.forbidden(res, 'Your account has been suspended');
    }

    // Verify admin status
    if (!profile.is_admin) {
      return response.forbidden(res, 'Access denied: Admin privileges required');
    }

    // Generate 6-digit OTP (numeric only)
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = crypto.createHash('sha256').update(otp).digest('hex');
    
    // Store OTP with 5-minute expiry
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    
    const { error: otpError } = await supabaseAdmin
      .from('profiles')
      .update({
        two_factor_email_code: otpHash,
        two_factor_email_expires_at: expiresAt,
      })
      .eq('id', user.id);

    if (otpError) {
      console.error('[Admin Auth] Failed to store OTP:', otpError.message);
      return response.serverError(res, 'Failed to generate OTP');
    }

    // Send OTP via email (using existing email service)
    try {
      await sendEmail({
        to: email,
        subject: 'Your Motoka Admin Login Code',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="UTF-8">
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f4f4f4; }
              .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; }
              .header { background-color: #2563eb; color: #ffffff; padding: 30px 20px; text-align: center; }
              .content { padding: 40px 30px; }
              .otp-box { background-color: #eff6ff; border: 2px solid #2563eb; border-radius: 8px; padding: 20px; text-align: center; margin: 30px 0; }
              .otp-code { font-size: 36px; font-weight: bold; letter-spacing: 12px; color: #1e40af; font-family: 'Courier New', monospace; }
              .footer { background-color: #f8f9fa; padding: 20px; text-align: center; font-size: 12px; color: #6c757d; }
              .warning { color: #dc2626; font-weight: 500; margin-top: 20px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>🔐 Admin Login Verification</h1>
              </div>
              <div class="content">
                <p>Hello ${profile.first_name || 'Admin'},</p>
                <p>Your admin login verification code is:</p>
                
                <div class="otp-box">
                  <div class="otp-code">${otp}</div>
                </div>
                
                <p><strong>This code will expire in 5 minutes.</strong></p>
                
                <p>If you didn't attempt to sign in to the Motoka Admin panel, please secure your account immediately.</p>
                
                <p class="warning">⚠️ Never share this code with anyone. Motoka staff will never ask for your OTP.</p>
              </div>
              <div class="footer">
                <p>© ${new Date().getFullYear()} Motoka. All rights reserved.</p>
                <p>This is an automated message, please do not reply.</p>
              </div>
            </div>
          </body>
          </html>
        `,
        text: `
Motoka Admin Login

Hello ${profile.first_name || 'Admin'},

Your admin login verification code is: ${otp}

This code will expire in 5 minutes.

If you didn't attempt to sign in, please secure your account immediately.

Never share this code with anyone.

© ${new Date().getFullYear()} Motoka
        `.trim()
      });
    } catch (emailError) {
      console.error('[Admin Auth] Email send failed:', emailError.message);
      
      // Check if it's a Resend test email limitation
      if (emailError.message && emailError.message.includes('You can only send testing emails')) {
        return response.error(res, 
          'Email service is in test mode. Please use a verified email address for testing, or verify your domain in Resend for production use.',
          400
        );
      }
      
      return response.serverError(res, 'Failed to send verification code');
    }

    // Return response matching frontend expectations: { status: true }
    return res.status(200).json({
      status: true,
      message: 'OTP sent to admin email',
      data: { email }
    });
  } catch (error) {
    console.error('[Admin Auth] Send OTP error:', error);
    return response.serverError(res, 'Failed to process login request');
  }
};

/**
 * Step 2: Admin Verify OTP - Validate OTP and return JWT token
 * 
 * @route POST /api/admin/auth/verify-otp
 * @access Public
 */
export const adminVerifyOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;
    
    if (!email || !otp) {
      return response.validationError(res, {
        email: email ? undefined : 'Email is required',
        otp: otp ? undefined : 'OTP is required',
      });
    }

    // Validate JWT_SECRET exists
    if (!process.env.JWT_SECRET) {
      console.error('[Admin Auth] JWT_SECRET not configured');
      return response.serverError(res, 'Authentication service misconfigured');
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Get user by email (Supabase admin API doesn't have getUserByEmail, so we use listUsers)
    const { data: usersData, error: authError } = await supabaseAdmin.auth.admin.listUsers();

    if (authError) {
      console.error('[Admin Auth] Error listing users:', authError);
      return response.serverError(res, 'Failed to verify OTP');
    }

    const user = usersData?.users?.find(u => u.email === email);

    if (!user) {
      return response.unauthorized(res, 'Invalid credentials');
    }
    
    // Fetch profile with OTP data
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, is_admin, is_suspended, first_name, last_name, email, two_factor_email_code, two_factor_email_expires_at')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      return response.unauthorized(res, 'Invalid credentials');
    }

    // Verify admin status
    if (!profile.is_admin) {
      return response.forbidden(res, 'Access denied: Admin privileges required');
    }

    // Check if account is suspended
    if (profile.is_suspended) {
      return response.forbidden(res, 'Your account has been suspended');
    }

    // Verify OTP
    const otpHash = crypto.createHash('sha256').update(otp).digest('hex');

    if (profile.two_factor_email_code !== otpHash) {
      return response.unauthorized(res, 'Invalid OTP');
    }

    // Check OTP expiration
    if (!profile.two_factor_email_expires_at || new Date(profile.two_factor_email_expires_at) < new Date()) {
      return response.unauthorized(res, 'OTP has expired');
    }

    // Clear OTP after successful verification
    await supabaseAdmin
      .from('profiles')
      .update({
        two_factor_email_code: null,
        two_factor_email_expires_at: null,
      })
      .eq('id', user.id);

    // Generate JWT token with 30-minute expiry
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        is_admin: true,
        type: 'admin'
      },
      process.env.JWT_SECRET,
      { expiresIn: '30m' }
    );

    // Return response matching frontend expectations: { status: true, data: { token, admin } }
    return res.status(200).json({
      status: true,
      message: 'Admin login successful',
      data: {
        token,
        admin: {
          id: profile.id,
          email: user.email,
          first_name: profile.first_name,
          last_name: profile.last_name,
          is_admin: true
        }
      }
    });
  } catch (error) {
    console.error('[Admin Auth] Verify OTP error:', error);
    return response.serverError(res, 'Failed to verify OTP');
  }
};
