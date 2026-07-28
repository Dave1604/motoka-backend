import pino from 'pino';
import pretty from 'pino-pretty';

const isDevelopment = process.env.NODE_ENV === 'development';
const logLevel = process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info');

const redactSensitiveData = (obj) => {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  const sensitiveKeys = [
    'password',
    'token',
    'secret',
    'key',
    'api_key',
    'apiKey',
    'public_key',
    'private_key',
    'publicKey',
    'privateKey',
    'authorization',
    'authorization_header',
    'auth',
    'credential',
    'credentials',
    'access_token',
    'refresh_token',
    'session_token',
    'jwt',
    'bearer',
    'monicredit_public_key',
    'monicredit_private_key',
    'paystack_secret_key',
    'paystack_public_key',
    'supabase_service_role_key',
    'supabase_anon_key',
    'resend_api_key'
  ];

  const redacted = Array.isArray(obj) ? [...obj] : { ...obj };

  for (const key in redacted) {
    const lowerKey = key.toLowerCase();
    
    if (sensitiveKeys.some(sensitive => lowerKey.includes(sensitive))) {
      redacted[key] = '***REDACTED***';
    } else if (typeof redacted[key] === 'object' && redacted[key] !== null) {
      redacted[key] = redactSensitiveData(redacted[key]);
    }
  }

  return redacted;
};

const requestSerializer = (req) => {
  if (!req) return req;
  
  return {
    method: req.method,
    url: req.url,
    path: req.path,
    query: req.query,
    headers: redactSensitiveData(req.headers),
    remoteAddress: req.remoteAddress,
    remotePort: req.remotePort
  };
};

const errorSerializer = (err) => {
  if (!err) return err;
  
  const serialized = {
    type: err.name || 'Error',
    message: err.message,
    stack: err.stack
  };

  if (err.code) serialized.code = err.code;
  if (err.statusCode) serialized.statusCode = err.statusCode;
  if (err.status) serialized.status = err.status;
  
  if (err.data) {
    serialized.data = redactSensitiveData(err.data);
  }

  return serialized;
};

const pinoConfig = {
  level: logLevel,
  formatters: {
    level: (label) => {
      return { level: label.toUpperCase() };
    }
  },
  serializers: {
    req: requestSerializer,
    err: errorSerializer,
    error: errorSerializer
  },
  redact: {
    paths: [
      'password',
      'token',
      'secret',
      '*.key',
      '*.api_key',
      '*.apiKey',
      '*.public_key',
      '*.private_key',
      '*.secret_key',
      'headers.authorization',
      'headers.cookie',
      '*.authorization',
      '*.credentials'
    ],
    remove: true
  }
};

// Use a sync pretty stream in development. pino's worker-thread transport
// crashes under `node --watch` (thread-stream), which breaks local `npm run dev`.
const destination = isDevelopment
  ? pretty({
      colorize: true,
      translateTime: 'HH:MM:ss.l',
      ignore: 'pid,hostname',
      singleLine: false
    })
  : undefined;

export const logger = pino(pinoConfig, destination);

export const safeLogData = (data) => {
  return redactSensitiveData(data);
};

export default logger;
