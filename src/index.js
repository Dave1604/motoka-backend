import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '..', '.env') });

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import authRoutes from './routes/auth.routes.js';
import carRoutes from './routes/car.routes.js';
import documentRoutes from './routes/document.routes.js';
import driverLicenseApplicationRoutes from './routes/driverLicenseApplication.routes.js';
import profileRoutes from './routes/profile.routes.js';
import adminRoutes from './routes/admin.routes.js';
import adminAuthRoutes from './routes/adminAuth.routes.js';
import notificationRoutes from './routes/notifications.routes.js';
import paymentRoutes from './routes/payment.routes.js';
import { apiLimiter } from './middleware/rateLimiter.js';
import { getCorsConfig } from './config/cors.config.js';
import paymentMetrics from './services/payment/metrics.service.js';
import { logInfo, logWarn } from './utils/logger.js';

const isProduction = process.env.NODE_ENV === 'production';

const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'JWT_SECRET'];

const productionRequiredEnvVars = [
  'MONICREDIT_WEBHOOK_SECRET',
  'ALLOWED_ORIGINS'
];


const missingEnvVars = requiredEnvVars.filter(key => !process.env[key]);

if (missingEnvVars.length > 0) {
  console.error('Missing required environment variables:', missingEnvVars.join(', '));
  console.error('Application cannot start without these variables.');
  process.exit(1);
}

if (isProduction) {
  const missingProductionVars = productionRequiredEnvVars.filter(key => !process.env[key]);
  
  if (missingProductionVars.length > 0) {
    console.error('╔══════════════════════════════════════════════════════════════╗');
    console.error('║  PRODUCTION CONFIGURATION ERROR                             ║');
    console.error('╚══════════════════════════════════════════════════════════════╝');
    console.error('');
    console.error('Missing required production environment variables:');
    missingProductionVars.forEach(varName => {
      console.error(`  ❌ ${varName}`);
    });
    console.error('');
    console.error('These variables are mandatory for production security:');
    console.error('  • MONICREDIT_WEBHOOK_SECRET: Required for webhook signature verification');
    console.error('  • ALLOWED_ORIGINS: Required for CORS origin restrictions');
    console.error('');
    console.error('Set these variables in your production environment before starting.');
    console.error('Application cannot start without these security configurations.');
    process.exit(1);
  }
  
  console.log('✅ Production security configuration validated');
}

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  referrerPolicy: {
    policy: "strict-origin-when-cross-origin"
  },
  xContentTypeOptions: true,
  xFrameOptions: { action: 'deny' },
  xXssProtection: true,
  hidePoweredBy: true
}));

app.use(cors(getCorsConfig()));

app.use('/api/webhooks/paystack', express.raw({ type: 'application/json', limit: '2mb' }));
app.use('/api/webhooks/monicredit', express.raw({ type: 'application/json', limit: '2mb' }));

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
app.use('/api', carRoutes);
app.use('/api', documentRoutes);
app.use('/api', driverLicenseApplicationRoutes);
app.use('/api/settings/profile', profileRoutes);
// Mount admin auth routes BEFORE admin routes to avoid middleware interference
app.use('/api/admin', adminAuthRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', notificationRoutes);
app.use('/api', paymentRoutes);

app.get('/api/docs', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}/api`;
  
  res.json({
    name: 'Motoka API',
    version: '1.0.0',
    baseUrl,
    
    endpoints: {
      public: {
        'POST /register': 'Register a new user',
        'POST /login': 'Login with email/password',
        'POST /send-login-otp': 'Send OTP for passwordless login',
        'POST /verify-login-otp': 'Verify OTP and login',
        'POST /send-otp': 'Send OTP for password reset',
        'POST /verify-otp': 'Verify password reset OTP',
        'POST /reset-password': 'Reset password with token',
        'POST /verify/email-resend': 'Resend email verification',
        'POST /refresh': 'Refresh access token',
        'POST /2fa/verify-login': 'Verify 2FA during login'
      },
      protected: {
        'GET /me': 'Get current user profile',
        'POST /logout': 'Logout user',
        'GET /2fa/status': 'Check 2FA status',
        'POST /2fa/enable-google': 'Enable Google Authenticator',
        'POST /2fa/verify-google': 'Verify Google Authenticator setup',
        'POST /2fa/enable-email': 'Enable email 2FA',
        'POST /2fa/verify-email': 'Verify email 2FA code',
        'POST /2fa/disable': 'Disable 2FA',
        'POST /reg-car': 'Register a new car',
        'GET /get-cars': 'Get all cars for authenticated user',
        'GET /cars/:slug': 'Get a specific car by slug',
        'PUT /cars/:slug': 'Update a specific car by slug',
        'DELETE /cars/:slug': 'Delete a specific car by slug (soft delete)'
      },
      
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
      },
      
      // ====== PROFILE SETTINGS ======
      
      // GET PROFILE (Protected)
      'settings_get_profile': {
        method: 'GET',
        url: `${baseUrl}/settings/profile`,
        description: 'Get current user profile details',
        headers: {
          'Authorization': 'Bearer <access_token>'
        },
        response: { success: '{ profile: { id, user_id, email, first_name, last_name, phone_number, image, ... } }' }
      },
      
      // UPDATE PROFILE (Protected)
      'settings_update_profile': {
        method: 'PUT',
        url: `${baseUrl}/settings/profile`,
        description: 'Update current user profile',
        headers: {
          'Authorization': 'Bearer <access_token>',
          'Content-Type': 'application/json'
        },
        body: {
          first_name: { type: 'string', required: false, example: 'John' },
          last_name: { type: 'string', required: false, example: 'Doe' },
          phone_number: { type: 'string', required: false, example: '+2348012345678' },
          image: { type: 'string', required: false, example: 'https://example.com/avatar.jpg' },
          nin: { type: 'string', required: false, example: 'AB123456789' },
          address: { type: 'string', required: false, example: '123 Main Street, Lagos' },
          gender: { type: 'string', required: false, example: 'male', enum: ['male', 'female', 'other'] }
        },
        response: { success: '{ profile: { ... } }' }
      },
      
      // ====== ADMIN USER MANAGEMENT ======
      
      // LIST USERS (Admin)
      'admin_list_users': {
        method: 'GET',
        url: `${baseUrl}/admin/users`,
        description: 'List all users (admin only)',
        headers: {
          'Authorization': 'Bearer <admin_access_token>'
        },
        query: {
          page: { type: 'number', required: false, default: 1, example: 1 },
          limit: { type: 'number', required: false, default: 20, example: 20 },
          search: { type: 'string', required: false, example: 'john' },
          status: { type: 'string', required: false, example: 'active', enum: ['active', 'suspended'] }
        },
        response: { success: '{ users: [...], pagination: { total, page, limit, pages } }' }
      },
      
      // GET SINGLE USER (Admin)
      'admin_get_user': {
        method: 'GET',
        url: `${baseUrl}/admin/users/:userId`,
        description: 'Get single user details (admin only)',
        headers: {
          'Authorization': 'Bearer <admin_access_token>'
        },
        response: { success: '{ user: { id, user_id, email, first_name, last_name, is_suspended, kyc_status, ... } }' }
      },
      
      // SUSPEND USER (Admin)
      'admin_suspend_user': {
        method: 'PUT',
        url: `${baseUrl}/admin/users/:userId/suspend`,
        description: 'Suspend a user account (admin only)',
        headers: {
          'Authorization': 'Bearer <admin_access_token>',
          'Content-Type': 'application/json'
        },
        body: {
          reason: { type: 'string', required: false, example: 'Violation of terms of service' }
        },
        response: { success: '{ user_id, is_suspended: true }' }
      },
      
      // ACTIVATE USER (Admin)
      'admin_activate_user': {
        method: 'PUT',
        url: `${baseUrl}/admin/users/:userId/activate`,
        description: 'Reactivate a suspended user account (admin only)',
        headers: {
          'Authorization': 'Bearer <admin_access_token>'
        },
        response: { success: '{ user_id, is_suspended: false }' }
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
  
  const METRICS_LOG_INTERVAL_MS = 5 * 60 * 1000;
  
  setInterval(() => {
    try {
      const snapshot = paymentMetrics.getSnapshot();
      const successRate = paymentMetrics.getSuccessRate();
      const webhookSuccessRate = paymentMetrics.getWebhookSuccessRate();
      
      logInfo('[Payment Metrics] Periodic snapshot', {
        transactions: {
          total: snapshot.transactions.total,
          successful: snapshot.transactions.successful,
          failed: snapshot.transactions.failed,
          pending: snapshot.transactions.pending,
          successRate: `${successRate}%`
        },
        amounts: {
          total_kobo: snapshot.amounts.total,
          total_naira: (snapshot.amounts.total / 100).toFixed(2),
          successful_kobo: snapshot.amounts.successful,
          successful_naira: (snapshot.amounts.successful / 100).toFixed(2),
          average_kobo: snapshot.amounts.average,
          average_naira: (snapshot.amounts.average / 100).toFixed(2)
        },
        gateways: {
          paystack: {
            total: snapshot.gateways.paystack.total,
            successRate: `${paymentMetrics.getGatewaySuccessRate('paystack')}%`
          },
          monicredit: {
            total: snapshot.gateways.monicredit.total,
            successRate: `${paymentMetrics.getGatewaySuccessRate('monicredit')}%`
          }
        },
        webhooks: {
          received: snapshot.webhooks.received,
          processed: snapshot.webhooks.processed,
          failed: snapshot.webhooks.failed,
          successRate: `${webhookSuccessRate}%`,
          signatureVerified: snapshot.webhooks.signatureVerified,
          signatureFailed: snapshot.webhooks.signatureFailed,
          duplicate: snapshot.webhooks.duplicate
        },
        processingTimes: {
          avgInitialization_ms: snapshot.calculated.averageInitializationTime,
          avgVerification_ms: snapshot.calculated.averageVerificationTime,
          avgWebhook_ms: snapshot.calculated.averageWebhookTime
        },
        errors: {
          timeout: snapshot.errors.timeout,
          network: snapshot.errors.network,
          api: snapshot.errors.api,
          validation: snapshot.errors.validation,
          other: snapshot.errors.other
        },
        retries: {
          total: snapshot.retries.total,
          successful: snapshot.retries.successful,
          failed: snapshot.retries.failed
        },
        timestamps: {
          firstTransaction: snapshot.firstTransaction,
          lastTransaction: snapshot.lastTransaction
        }
      });
      
      if (successRate < 80 && snapshot.transactions.total > 10) {
        logWarn('[Payment Metrics] Low success rate detected', {
          successRate: `${successRate}%`,
          totalTransactions: snapshot.transactions.total,
          failedTransactions: snapshot.transactions.failed
        });
      }
      
      if (webhookSuccessRate < 90 && snapshot.webhooks.received > 10) {
        logWarn('[Payment Metrics] Low webhook success rate detected', {
          webhookSuccessRate: `${webhookSuccessRate}%`,
          totalWebhooks: snapshot.webhooks.received,
          failedWebhooks: snapshot.webhooks.failed
        });
      }
      
      if (snapshot.errors.timeout > 10) {
        logWarn('[Payment Metrics] High timeout error count', {
          timeoutErrors: snapshot.errors.timeout,
          totalTransactions: snapshot.transactions.total
        });
      }
      
    } catch (error) {
      console.error('Error logging metrics:', error);
    }
  }, METRICS_LOG_INTERVAL_MS);
  
  logInfo('Periodic metrics logging started', {
    interval_minutes: METRICS_LOG_INTERVAL_MS / 60000
  });
});

export default app;
