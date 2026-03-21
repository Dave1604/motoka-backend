# Motoka Backend — Architecture & Overview

> **Version:** 1.0 · **Last updated:** March 18, 2026

---

## What is Motoka?

Motoka is a vehicle licensing and renewal management platform for Nigeria. The backend is a Node.js/Express REST API backed by Supabase (PostgreSQL). It handles user authentication, vehicle registration, payment processing, document management, admin operations, and automated notifications.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js (ESM) ≥18 |
| Framework | Express 4.21 |
| Database | Supabase PostgreSQL + Row Level Security |
| Auth | Supabase Auth (users) · JWT/HS256 (admins) |
| Email | Resend |
| Payments | Paystack · Monicredit |
| WhatsApp | Twilio |
| 2FA | speakeasy (TOTP) + qrcode |
| File Storage | Supabase Storage (via Multer) |
| Edge Functions | Deno (Supabase Edge Functions) |
| Testing | Jest + Supertest |
| Security | Helmet · CORS · express-rate-limit · express-validator |
| Deployment | Render.com |

---

## Project Structure

```
motoka-backend/
├── src/
│   ├── index.js                          # Server entry point
│   ├── config/
│   │   ├── supabase.js                   # Singleton Supabase client
│   │   ├── cors.config.js                # CORS origin validation
│   │   └── logger.config.js              # Pino logger setup
│   │
│   ├── middleware/
│   │   ├── authenticate.js               # User JWT validation + profile caching
│   │   ├── authenticateAdmin.js          # Admin JWT validation
│   │   ├── checkAdmin.js                 # Admin role check
│   │   ├── checkEmailVerified.js         # Email verification gate
│   │   ├── rateLimiter.js                # Tiered rate limiting
│   │   ├── fileUpload.js                 # Multer config
│   │   ├── verifyPaystackWebhook.js      # HMAC-SHA256 signature check
│   │   └── verifyMonicreditWebhook.js    # HMAC-SHA256 signature check
│   │
│   ├── routes/
│   │   ├── auth.routes.js                # Register, login, 2FA, OAuth
│   │   ├── car.routes.js                 # Vehicle CRUD + plate number
│   │   ├── payment.routes.js             # Payment init, verify, webhooks
│   │   ├── admin.routes.js               # Admin dashboard operations
│   │   ├── adminAuth.routes.js           # Admin OTP login
│   │   ├── profile.routes.js             # User profile
│   │   ├── document.routes.js            # Document upload/retrieval
│   │   ├── driverLicenseApplication.routes.js
│   │   ├── notifications.routes.js       # In-app notifications
│   │   ├── guest.routes.js               # Guest renewal flow
│   │   ├── public.routes.js              # States, LGAs, renewal items
│   │   └── whatsapp.routes.js            # Twilio inbound webhook
│   │
│   ├── controllers/                      # HTTP handlers → delegate to services
│   │   ├── auth.controller.js
│   │   ├── car.controller.js
│   │   ├── admin.controller.js
│   │   ├── adminAuth.controller.js
│   │   ├── profile.controller.js
│   │   ├── document.controller.js
│   │   ├── driverLicenseApplication.controller.js
│   │   ├── oauth.controller.js
│   │   ├── twoFactor.controller.js
│   │   ├── public.controller.js
│   │   ├── payment/
│   │   │   ├── payment-init.controller.js
│   │   │   ├── payment-verification.controller.js
│   │   │   ├── payment-status.controller.js
│   │   │   ├── webhook.controller.js
│   │   │   ├── order.controller.js
│   │   │   └── subscription.controller.js
│   │   └── guest/
│   │       ├── guestRenewal.controller.js
│   │       └── guestSignup.controller.js
│   │
│   ├── services/                         # Core business logic
│   │   ├── car.service.js
│   │   ├── carDuplicateChecker.js
│   │   ├── notification.service.js
│   │   ├── document.service.js
│   │   ├── driverLicenseApplication.service.js
│   │   ├── twoFactor.service.js
│   │   ├── fileUpload.service.js
│   │   ├── location.service.js
│   │   ├── email/
│   │   │   ├── email.service.js          # Resend integration
│   │   │   ├── paymentEmail.service.js
│   │   │   └── carEmail.service.js
│   │   ├── whatsapp/
│   │   │   └── whatsapp.service.js       # Twilio WhatsApp
│   │   ├── guest/
│   │   │   └── guestRenewal.service.js
│   │   └── payment/
│   │       ├── index.js
│   │       ├── transaction.service.js
│   │       ├── order.service.js
│   │       ├── subscription.service.js
│   │       ├── paystack.service.js
│   │       ├── monicredit/
│   │       │   ├── monicredit.service.js
│   │       │   ├── monicredit.adapter.js
│   │       │   └── monicredit.normalizer.js
│   │       ├── payment-success.service.js
│   │       ├── renewalItems.service.js
│   │       ├── idempotency.service.js
│   │       ├── metrics.service.js
│   │       ├── audit.service.js
│   │       ├── gateway/
│   │       │   ├── gateway.interface.js
│   │       │   ├── gateway.factory.js
│   │       │   ├── gateway-manager.js
│   │       │   └── health-monitor.js
│   │       └── validation/
│   │           ├── amount.validator.js
│   │           ├── input.sanitizer.js
│   │           └── response.validator.js
│   │
│   ├── utils/                            # Helpers
│   │   ├── logger.js
│   │   ├── responses.js
│   │   ├── validators.js
│   │   ├── idGenerator.js
│   │   ├── retry.js
│   │   ├── paymentHelpers.js
│   │   ├── fileValidator.js
│   │   ├── expiryStatus.js
│   │   └── car*.js (validators, sanitization, data builder)
│   │
│   ├── constants/
│   │   ├── car.constants.js
│   │   ├── payment.constants.js
│   │   └── states.constants.js
│   │
│   └── __tests__/
│
├── supabase/
│   ├── migrations/                       # 20+ SQL migrations
│   └── functions/
│       └── expiry-notifications/         # Deno edge function (daily cron)
│
├── scripts/                              # Dev utilities
├── docs/
├── render.yaml                           # Deployment config
├── .env.example
└── package.json
```

---

## Server Initialization (`src/index.js`)

1. Load `.env` and validate required variables
2. Apply global middleware: Helmet → CORS → raw body (webhooks) → JSON parser → rate limiter
3. Mount routes (see Route Map below)
4. Start health-check endpoints (`/`, `/health`, `/api/docs`)
5. Start payment metrics logger (every 5 minutes)

---

## Route Map

| Mount | Route file | Purpose |
|-------|-----------|---------|
| `/api` | `public.routes.js` | Reference data: states, LGAs, renewal items |
| `/api` | `guest.routes.js` | Unauthenticated guest renewal |
| `/api` | `auth.routes.js` | Register, login, 2FA, OAuth, password reset |
| `/api` | `car.routes.js` | Vehicle CRUD, plate number |
| `/api` | `document.routes.js` | Document upload/retrieval |
| `/api` | `driverLicenseApplication.routes.js` | Driver license applications |
| `/api/settings/profile` | `profile.routes.js` | User profile management |
| `/api/admin` | `adminAuth.routes.js` | Admin OTP login |
| `/api/admin` | `admin.routes.js` | Admin dashboard |
| `/api` | `notifications.routes.js` | In-app notifications |
| `/api` | `payment.routes.js` | Payment init, verify, webhooks |
| `/api/v1/whatsapp` | `whatsapp.routes.js` | Twilio webhook (dev only) |

---

## Authentication

### User Auth (Supabase)
- **Register** → email + password → Supabase creates auth user → triggers profile row
- **Email verification** → OTP sent to email
- **Login** → returns access token (1hr) + refresh token
- **Middleware:** `authenticate` validates Bearer token, caches profile (1-min TTL)

### Two-Factor Authentication
- **Google Authenticator** — speakeasy TOTP + QR code
- **Email OTP** — 6-digit code via Resend (5-min expiry)
- **Recovery codes** — generated on 2FA enable, stored hashed, single-use
- **Login flow:** credentials → `requires_2fa: true` + temp_token → verify 2FA → full session

### Admin Auth (JWT)
- Admin email → OTP via Resend → verify OTP → JWT (30-min, HS256)
- **Middleware:** `authenticateAdmin` + `checkAdmin` (checks `profiles.is_admin`)

---

## Core Features

### Vehicle Management
- Register vehicles with documents (registration cert, insurance, road worthiness, proof of ownership)
- Files uploaded to Supabase Storage via Multer
- Slug format: `{year}-{registration_number}` (URL-safe)
- Expiry status computed: not expiring / expiring soon / expired / renewal in progress
- Duplicate detection by registration number, chassis number, engine number

### Payment System
Multi-gateway architecture with abstraction layer:

**Gateways:**
- **Paystack** — cards, bank transfers
- **Monicredit** — government direct collection

**Payment types:** `renewal_manual`, `renewal_auto`, `new_registration`, `plate_number`, `driver_license`

**Flow:**
1. `POST /api/payments/initialize` → validate items/amount → create transaction → call gateway → return payment URL
2. User pays on gateway
3. Gateway webhook → verify signature → idempotency check → update transaction → create order → send email
4. `GET /api/payments/verify/:reference` → manual verification fallback

**Renewal item pricing (kobo):**

| Item | Price |
|------|-------|
| Vehicle Licence | ₦4,700 |
| Road Worthiness | ₦15,000 |
| Insurance | ₦15,000 |
| Referral | ₦3,290 |
| Proof of Ownership | ₦1,000 |

**Subscription plans:** Annual, Biannual, Quarterly

### Guest Renewal Flow
Unauthenticated users can complete renewals:

1. Enter vehicle details + contact info + select items
2. `POST /api/guest/renewals` → payment URL
3. Complete payment → webhook updates order → email receipt
4. Optional: `POST /api/guest/renewals/:id/signup` → create account, link order

### Admin Dashboard
- **User management** — list, search, suspend, activate, delete
- **Car management** — list with filters (search, car_type), view details
- **Order management** — list, view, update status (completed/cancelled)
- **Transaction management** — list, view, mark-paid, mark-failed, failed transactions
- **Document management** — list, approve, reject, upload, download
- **Guest orders** — list, view details
- **Dashboard stats** — user/car/payment aggregates, recent orders
- **Payment metrics** — success rates, gateway health
- **Broadcast** — WhatsApp add-car reminders

### Document Management
- Users upload documents for their vehicles
- Admins review, approve, or reject
- Admins can upload documents on behalf of users
- Stored in Supabase Storage

### Notifications
- **In-app** — stored in `notifications` table, paginated, filterable by category
- **Email** — Resend for all transactional emails
- **WhatsApp** — Twilio for expiry reminders, order updates, document ready, add-car reminders

### Automated Expiry Notifications
Supabase Edge Function (Deno) runs daily via cron:

- Checks vehicles expiring at: 30, 14, 7, 3, 2, 1, 0 days and 3, 7 days after
- Sends email via Resend + optional WhatsApp via Twilio
- Idempotent — tracks sent notifications in `expiry_notification_history`
- Errors logged to `expiry_notification_errors`

---

## Database Schema (Key Tables)

| Table | Purpose |
|-------|---------|
| `auth.users` | Supabase auth (email, password) |
| `profiles` | User data (name, phone, is_admin, is_suspended) |
| `cars` | Vehicle records (registration, expiry, documents) |
| `documents` | Uploaded documents (type, status, file URL) |
| `kycs` | KYC data (NIN, address) |
| `payment_transactions` | Payment records (reference, amount, status, gateway) |
| `renewal_orders` | Authenticated user orders |
| `guest_renewal_orders` | Guest orders |
| `guest_customers` | Guest contact info |
| `subscriptions` | Recurring payment plans |
| `renewal_items` | Configurable pricing |
| `notifications` | In-app notifications |
| `expiry_notification_history` | Sent expiry email tracking |
| `password_reset_tokens` | OTP-based reset flow |

**20+ SQL migrations** in `supabase/migrations/` covering the full schema evolution.

RLS (Row Level Security) enabled on all user-facing tables.

---

## Middleware Stack

| Middleware | Scope | Purpose |
|-----------|-------|---------|
| `helmet()` | Global | Security headers (CSP, HSTS, X-Frame-Options) |
| `cors()` | Global | Origin validation (www/non-www, localhost in dev) |
| `express.json()` | Global | JSON parsing (10MB limit) |
| `apiLimiter` | Global | 100 req/15min |
| `authenticate` | Protected | User JWT + profile cache |
| `authenticateAdmin` | Admin | Admin JWT validation |
| `checkAdmin` | Admin | `is_admin` flag check |
| `checkEmailVerified` | Sensitive | Email verification gate |
| `otpLimiter` | Auth | 5 req/15min |
| `paymentLimiter` | Payments | 20 req/15min |
| `passwordResetLimiter` | Reset | 3 req/1hr |
| `verifyPaystackWebhook` | Webhook | HMAC-SHA256 signature |
| `verifyMonicreditWebhook` | Webhook | HMAC-SHA256 signature |

---

## Security

- **Auth:** Supabase Auth + JWT admin + 2FA (TOTP + Email OTP + recovery codes)
- **RLS:** Database-level row isolation per user
- **Webhooks:** HMAC-SHA256 signature verification for both gateways
- **Idempotency:** Prevents duplicate webhook processing
- **Rate limiting:** Tiered by endpoint (in-memory, TODO: Redis)
- **Input validation:** express-validator on all inputs
- **Headers:** Helmet.js (CSP, HSTS, X-Frame-Options, etc.)
- **CORS:** Configurable origins, localhost in dev only
- **Profile cache:** 1-min TTL prevents stale suspension data

---

## Email System (Resend)

| Email | Trigger |
|-------|---------|
| Email Verification OTP | User signup |
| Password Reset OTP | User request |
| 2FA Code | 2FA verification |
| Payment Confirmation | Successful payment |
| Payment Failed | Payment failure |
| Vehicle Registered | New car added |
| Expiry Reminder | 30/14/7/3/2/1/0 days before + 3/7 days after |
| Guest Receipt | Guest payment success |

---

## WhatsApp Notifications (Twilio)

Four notification types, all gated by `WHATSAPP_REMINDERS_ENABLED=true`:

| Type | Trigger |
|------|---------|
| Expiry reminder | Edge function cron |
| Order update | Admin updates order to completed/cancelled |
| Document ready | Admin approves document |
| Add car reminder | Admin broadcast |

**Current status:** Sandbox mode. Production requires approved Meta templates (in progress) and verified WhatsApp Business number.

---

## Payment Metrics

Logged every 5 minutes:
- Total / successful / failed / pending transactions
- Success rates per gateway
- Webhook processing metrics
- Processing time averages
- Alerts: success rate < 80%, webhook rate < 90%, timeout errors > 10

---

## Environment Variables

### Required
```
SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
JWT_SECRET (128-char hex)
NODE_ENV, PORT
RESEND_API_KEY, EMAIL_FROM
PAYSTACK_SECRET_KEY, PAYSTACK_PUBLIC_KEY
MONICREDIT_BASE_URL, MONICREDIT_PUBLIC_KEY, MONICREDIT_PRIVATE_KEY
MONICREDIT_REVENUE_HEAD_CODE, MONICREDIT_WEBHOOK_SECRET
FRONTEND_URL, PAYMENT_CALLBACK_URL
ALLOWED_ORIGINS (production)
CRON_SECRET_KEY (edge function)
```

### WhatsApp (optional)
```
WHATSAPP_REMINDERS_ENABLED, WHATSAPP_SANDBOX_MODE
TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM
```

Full reference: `.env.example`

---

## Deployment

**Platform:** Render.com (configured via `render.yaml`)

**Checklist:**
1. Set all env vars (production keys, not test)
2. Run migrations: `npx supabase db push`
3. Deploy edge function for expiry notifications
4. Configure payment webhook URLs in Paystack/Monicredit dashboards
5. Verify email domain in Resend
6. Set `ALLOWED_ORIGINS` for CORS

---

## Design Patterns

- **Singleton** — Supabase client
- **Factory** — Payment gateway creation
- **Adapter** — Gateway response normalization (Paystack, Monicredit)
- **Service Layer** — Business logic separated from controllers
- **Middleware Chain** — Express middleware composition
- **Idempotency** — Webhook deduplication by (gateway, reference)

---

## Known TODOs

- Replace in-memory profile cache and rate limiting with Redis
- Implement webhook queue (Bull/RabbitMQ) for high-volume payments
- Add centralized error tracking (Sentry)
- Add OpenAPI/Swagger documentation
- Implement WhatsApp opt-in field on profiles table
- Migrate WhatsApp from sandbox to production templates
- Add automatic gateway failover
