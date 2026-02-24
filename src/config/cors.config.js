const isProduction = process.env.NODE_ENV === 'production';

function getAllowedOrigins() {
  const allowedOriginsEnv = process.env.ALLOWED_ORIGINS;
  
  if (!allowedOriginsEnv) {
    if (isProduction) {
      console.warn('[CORS] ALLOWED_ORIGINS not set in production - defaulting to empty array');
      return [];
    }
    return [];
  }
  
  return allowedOriginsEnv
    .split(',')
    .map(origin => origin.trim())
    .filter(origin => origin.length > 0);
}

function isLocalhostOrigin(origin) {
  if (!origin) return false;
  
  try {
    const url = new URL(origin);
    const hostname = url.hostname.toLowerCase();
    return hostname === 'localhost' || 
           hostname === '127.0.0.1' || 
           hostname.startsWith('localhost:') ||
           hostname.startsWith('127.0.0.1:');
  } catch {
    return false;
  }
}

export function getCorsConfig() {
  const allowedOrigins = getAllowedOrigins();
  
  return {
    origin: (origin, callback) => {
      const currentIsProduction = process.env.NODE_ENV === 'production';
      
      if (!origin) {
        return callback(null, true);
      }
      
      // Allow localhost in development mode
      if (!currentIsProduction && isLocalhostOrigin(origin)) {
        return callback(null, true);
      }
      
      // Allow if explicitly listed in ALLOWED_ORIGINS (even localhost in production)
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      
      // Allow localhost in production if ALLOWED_ORIGINS includes any localhost pattern
      // This helps when developing against production backend
      if (currentIsProduction && isLocalhostOrigin(origin)) {
        const hasLocalhostInAllowed = allowedOrigins.some(allowed => {
          try {
            const url = new URL(allowed);
            return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
          } catch {
            return allowed.includes('localhost') || allowed.includes('127.0.0.1');
          }
        });
        
        if (hasLocalhostInAllowed || process.env.ALLOW_LOCALHOST_IN_PRODUCTION === 'true') {
          console.warn('[CORS] Allowing localhost origin in production:', origin);
          return callback(null, true);
        }
      }
      
      console.warn('[CORS] Blocked request from unauthorized origin:', {
        origin,
        environment: process.env.NODE_ENV || 'development',
        allowedOrigins: allowedOrigins.length > 0 ? allowedOrigins : 'none configured',
        timestamp: new Date().toISOString()
      });
      
      if (currentIsProduction) {
        const error = new Error('Not allowed by CORS');
        return callback(error, false);
      }
      
      console.warn('[CORS] Allowing unauthorized origin in development mode:', origin);
      return callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Accept',
      'Cache-Control',
      'cache-control',
      'Pragma',
      'x-monicredit-signature',
      'x-signature',
      'x-paystack-signature'
    ],
    exposedHeaders: [],
    maxAge: 86400 // 24 hours
  };
}

export default getCorsConfig;
