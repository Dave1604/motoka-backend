import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '..', '.env') });

import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.routes.js';
import { apiLimiter } from './middleware/rateLimiter.js';

const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
const missingEnvVars = requiredEnvVars.filter(key => !process.env[key]);

if (missingEnvVars.length > 0 && process.env.NODE_ENV !== 'production') {
  console.error('Missing environment variables:', missingEnvVars.join(', '));
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.removeHeader('X-Powered-By');
  next();
});

// CORS - Allow all origins during development/testing phase
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(apiLimiter);

app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Motoka API is running',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    documentation: `${req.protocol}://${req.get('host')}/api/docs`,
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  const healthy = !missingEnvVars.length;
  res.status(healthy ? 200 : 503).json({
    success: healthy,
    status: healthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString()
  });
});

app.use('/api', authRoutes);

// Detailed API documentation with payloads
app.get('/api/docs', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}/api`;
  
  res.json({
    name: 'Motoka Authentication API',
    version: '1.0.0',
    baseUrl,
    
    endpoints: {
      
      // REGISTER
      register: {
        method: 'POST',
        url: `${baseUrl}/register`,
        description: 'Register a new user account',
        headers: { 'Content-Type': 'application/json' },
        body: {
          first_name: { type: 'string', required: true, example: 'John' },
          last_name: { type: 'string', required: true, example: 'Doe' },
          email: { type: 'string', required: true, example: 'john@gmail.com' },
          phone: { type: 'string', required: false, example: '+2341234567890' },
          password: { type: 'string', required: true, example: 'SecurePass123!' },
          password_confirmation: { type: 'string', required: true, example: 'SecurePass123!' }
        },
        response: {
          success: { user: '{ id, email, user_id, first_name, last_name, ... }', session: '{ access_token, refresh_token, expires_in }' },
          error: '{ success: false, message: "Email already registered" }'
        }
      },
      
      // LOGIN
      login: {
        method: 'POST',
        url: `${baseUrl}/login`,
        description: 'Login with email and password',
        headers: { 'Content-Type': 'application/json' },
        body: {
          email: { type: 'string', required: true, example: 'john@gmail.com' },
          password: { type: 'string', required: true, example: 'SecurePass123!' }
        },
        response: {
          success: { user: '{...}', session: '{ access_token, refresh_token, expires_in }' },
          requires_2fa: '{ requires_2fa: true, two_factor_method: "google", temp_token: "...", user_id: "..." }'
        }
      },
      
      // SEND LOGIN OTP
      send_login_otp: {
        method: 'POST',
        url: `${baseUrl}/send-login-otp`,
        description: 'Send OTP to email for passwordless login',
        headers: { 'Content-Type': 'application/json' },
        body: {
          email: { type: 'string', required: true, example: 'john@gmail.com' }
        },
        response: { success: '{ success: true, message: "OTP sent to your email" }' }
      },
      
      // VERIFY LOGIN OTP
      verify_login_otp: {
        method: 'POST',
        url: `${baseUrl}/verify-login-otp`,
        description: 'Verify OTP and login (passwordless)',
        headers: { 'Content-Type': 'application/json' },
        body: {
          email: { type: 'string', required: true, example: 'john@gmail.com' },
          otp: { type: 'string', required: true, example: '123456' }
        },
        response: { success: { user: '{...}', session: '{ access_token, refresh_token }' } }
      },
      
      // SEND PASSWORD RESET OTP
      send_otp: {
        method: 'POST',
        url: `${baseUrl}/send-otp`,
        description: 'Send OTP for password reset',
        headers: { 'Content-Type': 'application/json' },
        body: {
          email: { type: 'string', required: true, example: 'john@gmail.com' }
        },
        response: { success: '{ success: true, message: "OTP sent to your email" }' }
      },
      
      // VERIFY PASSWORD RESET OTP
      verify_otp: {
        method: 'POST',
        url: `${baseUrl}/verify-otp`,
        description: 'Verify OTP for password reset (returns reset_token)',
        headers: { 'Content-Type': 'application/json' },
        body: {
          email: { type: 'string', required: true, example: 'john@gmail.com' },
          otp: { type: 'string', required: true, example: '123456' }
        },
        response: { success: '{ success: true, data: { reset_token: "abc123..." } }' }
      },
      
      // RESET PASSWORD
      reset_password: {
        method: 'POST',
        url: `${baseUrl}/reset-password`,
        description: 'Reset password using the reset_token from verify-otp',
        headers: { 'Content-Type': 'application/json' },
        body: {
          email: { type: 'string', required: true, example: 'john@gmail.com' },
          token: { type: 'string', required: true, example: 'reset_token_from_verify_otp' },
          password: { type: 'string', required: true, example: 'NewSecurePass123!' },
          password_confirmation: { type: 'string', required: true, example: 'NewSecurePass123!' }
        },
        response: { success: '{ success: true, message: "Password reset successfully" }' }
      },
      
      // RESEND EMAIL VERIFICATION
      resend_email_verification: {
        method: 'POST',
        url: `${baseUrl}/verify/email-resend`,
        description: 'Resend email verification OTP',
        headers: { 'Content-Type': 'application/json' },
        body: {
          email: { type: 'string', required: true, example: 'john@gmail.com' }
        },
        response: { success: '{ success: true, message: "Verification email sent" }' }
      },
      
      // VERIFY EMAIL
      verify_email: {
        method: 'POST',
        url: `${baseUrl}/verify-email`,
        description: 'Verify email using OTP from signup email',
        headers: { 'Content-Type': 'application/json' },
        body: {
          email: { type: 'string', required: true, example: 'john@gmail.com' },
          otp: { type: 'string', required: true, example: '123456' }
        },
        response: { success: '{ user: {...}, session: { access_token, refresh_token, expires_in } }' }
      },
      
      // REFRESH TOKEN
      refresh: {
        method: 'POST',
        url: `${baseUrl}/refresh`,
        description: 'Refresh access token using refresh_token',
        headers: { 'Content-Type': 'application/json' },
        body: {
          refresh_token: { type: 'string', required: true, example: 'your_refresh_token' }
        },
        response: { success: '{ session: { access_token, refresh_token, expires_in } }' }
      },
      
      // GET CURRENT USER (Protected)
      me: {
        method: 'GET',
        url: `${baseUrl}/me`,
        description: 'Get current logged-in user profile',
        headers: {
          'Authorization': 'Bearer <access_token>'
        },
        body: null,
        response: { success: '{ user: { id, email, user_id, first_name, last_name, ... } }' }
      },
      
      // LOGOUT (Protected)
      logout: {
        method: 'POST',
        url: `${baseUrl}/logout`,
        description: 'Logout current user',
        headers: {
          'Authorization': 'Bearer <access_token>'
        },
        body: null,
        response: { success: '{ success: true, message: "Logged out successfully" }' }
      },
      
      // 2FA VERIFY LOGIN (for completing login when 2FA is enabled)
      '2fa_verify_login': {
        method: 'POST',
        url: `${baseUrl}/2fa/verify-login`,
        description: 'Complete login by verifying 2FA code',
        headers: { 'Content-Type': 'application/json' },
        body: {
          user_id: { type: 'string', required: true, example: 'uuid-from-login-response' },
          temp_token: { type: 'string', required: true, example: 'temp_token_from_login' },
          code: { type: 'string', required: true, example: '123456' }
        },
        response: { success: '{ user: {...} }' }
      },
      
      // 2FA STATUS (Protected)
      '2fa_status': {
        method: 'GET',
        url: `${baseUrl}/2fa/status`,
        description: 'Check if 2FA is enabled for current user',
        headers: { 'Authorization': 'Bearer <access_token>' },
        body: null,
        response: { success: '{ enabled: true/false, method: "google"/"email" }' }
      },
      
      // ENABLE GOOGLE 2FA (Protected)
      '2fa_enable_google': {
        method: 'POST',
        url: `${baseUrl}/2fa/enable-google`,
        description: 'Start Google Authenticator 2FA setup',
        headers: { 'Authorization': 'Bearer <access_token>' },
        body: null,
        response: { success: '{ secret: "...", qr_code: "data:image/png;base64,..." }' }
      },
      
      // VERIFY GOOGLE 2FA (Protected)
      '2fa_verify_google': {
        method: 'POST',
        url: `${baseUrl}/2fa/verify-google`,
        description: 'Confirm Google Authenticator setup with code',
        headers: {
          'Authorization': 'Bearer <access_token>',
          'Content-Type': 'application/json'
        },
        body: {
          code: { type: 'string', required: true, example: '123456' }
        },
        response: { success: '{ enabled: true, recovery_codes: ["ABC123", ...] }' }
      },
      
      // DISABLE 2FA (Protected)
      '2fa_disable': {
        method: 'POST',
        url: `${baseUrl}/2fa/disable`,
        description: 'Disable 2FA (requires password)',
        headers: {
          'Authorization': 'Bearer <access_token>',
          'Content-Type': 'application/json'
        },
        body: {
          password: { type: 'string', required: true, example: 'YourCurrentPassword' }
        },
        response: { success: '{ enabled: false }' }
      }
    },
    
    notes: {
      authentication: 'Protected endpoints require "Authorization: Bearer <access_token>" header',
      token_expiry: 'Access tokens expire in 1 hour. Use /refresh with refresh_token to get new tokens.',
      rate_limits: {
        general: '100 requests per 15 minutes',
        auth: '10 requests per 15 minutes',
        otp: '5 requests per 15 minutes'
      }
    }
  });
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.path} not found`
  });
});

app.use((err, req, res, next) => {
  const isDev = process.env.NODE_ENV === 'development';
  
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ success: false, message: 'Origin not allowed' });
  }
  
  if (err.name === 'ValidationError') {
    return res.status(422).json({ success: false, message: 'Validation failed' });
  }
  
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
  
  res.status(err.status || 500).json({
    success: false,
    message: isDev ? err.message : 'Internal server error'
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════════╗
║   MOTOKA API SERVER                          ║
║   URL: http://localhost:${PORT}                 ║
║   Environment: ${(process.env.NODE_ENV || 'development').padEnd(16)}       ║
║   Status: ${missingEnvVars.length ? 'DEGRADED' : 'READY ✅'}                       ║
╚══════════════════════════════════════════════╝
  `);
});

export default app;
