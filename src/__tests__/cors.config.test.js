import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

describe('CORS Configuration', () => {
  let getCorsConfig;
  const originalEnv = process.env;

  beforeEach(async () => {
    process.env = { ...originalEnv };
    const module = await import('../config/cors.config.js');
    getCorsConfig = module.getCorsConfig;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Production Mode', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
      process.env.ALLOWED_ORIGINS = 'https://example.com,https://www.example.com';
    });

    it('should allow requests from configured origins', (done) => {
      const config = getCorsConfig();
      const callback = (error, allowed) => {
        expect(error).toBeNull();
        expect(allowed).toBe(true);
        done();
      };
      
      config.origin('https://example.com', callback);
    });

    it('should reject requests from unauthorized origins', (done) => {
      const config = getCorsConfig();
      const callback = (error, allowed) => {
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe('Not allowed by CORS');
        expect(allowed).toBe(false);
        done();
      };
      
      config.origin('https://malicious.com', callback);
    });

    it('should allow requests with no origin', (done) => {
      const config = getCorsConfig();
      const callback = (error, allowed) => {
        expect(error).toBeNull();
        expect(allowed).toBe(true);
        done();
      };
      
      config.origin(undefined, callback);
    });

    it('should reject localhost in production', (done) => {
      const config = getCorsConfig();
      const callback = (error, allowed) => {
        // In production, localhost should be rejected
        if (process.env.NODE_ENV === 'production') {
          expect(error).toBeInstanceOf(Error);
          expect(error.message).toBe('Not allowed by CORS');
          expect(allowed).toBe(false);
        } else {
          // In development, it should be allowed
          expect(error).toBeNull();
          expect(allowed).toBe(true);
        }
        done();
      };
      
      config.origin('http://localhost:3000', callback);
    });
  });

  describe('Development Mode', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'development';
      process.env.ALLOWED_ORIGINS = 'https://example.com';
    });

    it('should allow localhost origins in development', (done) => {
      const config = getCorsConfig();
      const callback = (error, allowed) => {
        expect(error).toBeNull();
        expect(allowed).toBe(true);
        done();
      };
      
      config.origin('http://localhost:3000', callback);
    });

    it('should allow configured origins in development', (done) => {
      const config = getCorsConfig();
      const callback = (error, allowed) => {
        expect(error).toBeNull();
        expect(allowed).toBe(true);
        done();
      };
      
      config.origin('https://example.com', callback);
    });

    it('should allow unauthorized origins in development (with warning)', (done) => {
      const config = getCorsConfig();
      const originalWarn = console.warn;
      let warnCalled = false;
      
      console.warn = jest.fn((...args) => {
        if (args[0].includes('CORS')) {
          warnCalled = true;
        }
        originalWarn(...args);
      });
      
      const callback = (error, allowed) => {
        expect(error).toBeNull();
        expect(allowed).toBe(true);
        expect(warnCalled).toBe(true);
        console.warn = originalWarn;
        done();
      };
      
      config.origin('https://unauthorized.com', callback);
    });
  });

  describe('Configuration Parsing', () => {
    it('should parse comma-separated origins correctly', (done) => {
      process.env.NODE_ENV = 'production';
      process.env.ALLOWED_ORIGINS = 'https://example.com,https://www.example.com,https://api.example.com';
      
      const config = getCorsConfig();
      const callback = (error, allowed) => {
        expect(error).toBeNull();
        expect(allowed).toBe(true);
        done();
      };
      
      config.origin('https://api.example.com', callback);
    });

    it('should handle whitespace in origin list', (done) => {
      process.env.NODE_ENV = 'production';
      process.env.ALLOWED_ORIGINS = ' https://example.com , https://www.example.com ';
      
      const config = getCorsConfig();
      const callback = (error, allowed) => {
        expect(error).toBeNull();
        expect(allowed).toBe(true);
        done();
      };
      
      config.origin('https://example.com', callback);
    });

    it('should handle empty ALLOWED_ORIGINS in production', (done) => {
      process.env.NODE_ENV = 'production';
      delete process.env.ALLOWED_ORIGINS;
      
      const config = getCorsConfig();
      const callback = (error, allowed) => {
        expect(error).toBeInstanceOf(Error);
        expect(allowed).toBe(false);
        done();
      };
      
      config.origin('https://example.com', callback);
    });
  });

  describe('CORS Configuration Object', () => {
    it('should include required headers for webhook signatures', () => {
      const config = getCorsConfig();
      
      expect(config.allowedHeaders).toContain('x-monicredit-signature');
      expect(config.allowedHeaders).toContain('x-signature');
      expect(config.allowedHeaders).toContain('x-paystack-signature');
      expect(config.allowedHeaders).toContain('Idempotency-Key');
    });

    it('should include credentials support', () => {
      const config = getCorsConfig();
      expect(config.credentials).toBe(true);
    });

    it('should include standard HTTP methods', () => {
      const config = getCorsConfig();
      expect(config.methods).toContain('GET');
      expect(config.methods).toContain('POST');
      expect(config.methods).toContain('PUT');
      expect(config.methods).toContain('DELETE');
    });
  });
});
