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

const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5173',
  process.env.FRONTEND_URL
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || process.env.NODE_ENV === 'development') {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
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

app.get('/api/docs', (req, res) => {
  res.json({
    name: 'Motoka Authentication API',
    version: '1.0.0',
    baseUrl: `${req.protocol}://${req.get('host')}/api`,
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
        'POST /2fa/disable': 'Disable 2FA'
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
