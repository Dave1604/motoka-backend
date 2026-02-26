# Payment System

## Changes

### Gateway Architecture
- **Gateway abstraction layer** (`gateway/`) - Unified interface for multiple payment providers
- **Gateway manager** - Handles failover, circuit breakers, and health monitoring
- **Gateway factory** - Creates gateway instances based on configuration

### Monicredit Integration
- **Monicredit service** (`monicredit/`) - Full implementation of Monicredit payment gateway
- **Monicredit adapter** - Normalizes Monicredit responses to standard format
- **Webhook verification** (`middleware/verifyMonicreditWebhook.js`) - Validates Monicredit webhook signatures

### Paystack Refactoring
- **Paystack adapter** (`paystack/`) - Extracted into adapter pattern for consistency

### Validation Layer
- **Amount validator** - Prevents payment amount tampering
- **Input sanitizer** - Cleans user inputs before processing
- **Response validator** - Validates gateway responses

### Metrics & Monitoring
- **Metrics service** - Tracks transaction success rates, processing times, gateway performance
- **Health monitor** - Monitors gateway availability and triggers failover

### Payment Success Processing
- **Payment success service** - Handles post-payment actions (emails, notifications, subscriptions)

### Controller Refactoring
- Split `payment.controller.js` into focused controllers:
  - `order.controller.js` - Order management
  - `payment-init.controller.js` - Payment initialization
  - `payment-verification.controller.js` - Payment verification
  - `payment-status.controller.js` - Status checks
  - `webhook.controller.js` - Webhook handling
  - `subscription.controller.js` - Subscription management

## Configuration

Set `PRIMARY_GATEWAY` and `FALLBACK_GATEWAY` in environment variables. See `env.example` for Monicredit configuration.
