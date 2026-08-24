# Configuration

## Changes

### CORS Configuration (`cors.config.js`)
- Centralized CORS policy management
- Environment-aware origin validation
- Supports localhost in development, strict validation in production
- Allows webhook signature headers (`x-monipay-signature`, `x-paystack-signature`, `x-monicredit-signature`)

### Logger Configuration (`logger.config.js`)
- Pino-based structured logging
- Automatic sensitive data redaction (API keys, tokens, passwords)
- Environment-specific formatting (pretty in development, JSON in production)
- Custom serializers for requests and errors
