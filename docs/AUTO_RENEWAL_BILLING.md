# Auto-Renewal & Billing System

Motoka's auto-renewal system automatically renews vehicle documents (vehicle licence, insurance, road worthiness) before expiry. Users save a card once and the system handles everything — including retries, pre-charge notifications, and card expiry detection.

---

## Table of Contents

1. [How It Works — Three Scenarios](#how-it-works)
2. [System Architecture](#system-architecture)
3. [API Endpoints](#api-endpoints)
4. [Database Schema](#database-schema)
5. [Auto-Billing Job](#auto-billing-job)
6. [Notifications](#notifications)
7. [Error Handling & Retry Logic](#error-handling--retry-logic)
8. [Security](#security)
9. [Testing Checklist](#testing-checklist)

---

## How It Works

There are three paths into the auto-renewal system:

### Scenario A — User pays to renew, then enables auto-renewal (existing flow)

```
User selects documents → Pays via Paystack/Monicredit
    → Paystack webhook fires → subscription activated with card authorization_code
    → auto-billing picks it up 14 days before next expiry
```

This is the primary flow. The card is captured during the payment so no extra steps are needed.

### Scenario B — Papers are valid, user enables auto-renewal in Settings (new flow)

```
User opens Settings → Auto Renewal → clicks "Enable" on a car with > 45 days to expiry
    → CardSetupModal opens
    → User selects which documents to auto-renew
    → POST /api/subscriptions/card-setup called
    → Subscription created (pending, billing date = expiry - 14 days)
    → ₦50 Paystack charge initiated (card-only, immediately refunded)
    → User completes card entry in Paystack popup
    → Paystack webhook: subscription activated, ₦50 refunded
    → Auto-billing picks it up 14 days before expiry (no action until then)
```

Nothing is charged today except the ₦50 verification — refunded within 24 hours.

### Scenario C — Auto-billing fires (recurring)

```
Hourly job runs → finds subscriptions due for billing
    → 30 days before expiry: sends pre-charge notification
    → 14 days before expiry: first charge attempt
    →  7 days before expiry: second attempt (if first failed)
    →  3 days before expiry: final attempt (if second failed)
    → On success: car expiry extended 1 year, next_billing_date updated
    → On 3 failures: subscription paused, user notified to update card
```

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        FRONTEND                             │
│                                                             │
│  Settings → AutoRenewalSettings                             │
│      ├── Papers valid (> 45 days)  → CardSetupModal         │
│      └── Papers expiring soon      → /licenses/renew        │
│                                                             │
│  CardSetupModal                                             │
│      ├── Fetches renewal items (GET /payment-schedule)      │
│      ├── User selects documents + sees total                │
│      ├── POST /subscriptions/card-setup                     │
│      └── Opens Paystack popup → polls for close → success   │
└─────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                         BACKEND                             │
│                                                             │
│  POST /api/subscriptions/card-setup                         │
│      ├── Validate: car exists, owned by user, > 45 day exp  │
│      ├── Validate: no active subscription already           │
│      ├── Calculate amount from selected renewal items        │
│      ├── Set next_billing_date = car.expiry_date - 14 days  │
│      ├── Create subscription (status: pending)              │
│      ├── Create ₦50 tokenization transaction                │
│      └── Initialize Paystack (card-only channels)           │
│                                                             │
│  POST /api/webhooks/paystack (charge.success)               │
│      ├── Tokenization payment: activate subscription        │
│      │       → store authorization_code + card details      │
│      │       → create ₦50 refund                           │
│      └── Full payment: activate subscription (Scenario A)   │
│                                                             │
│  Auto-Billing Job (hourly)                                  │
│      ├── sendPreChargeNotifications() — 30-day heads-up     │
│      ├── getSubscriptionsDueToday() — active subs with auth │
│      ├── isCardExpired() check — skip + notify if expired   │
│      ├── chargeAuthorization() — Paystack recurring charge  │
│      ├── Success: update dates, extend car expiry 1 year    │
│      └── Failure: retry at 7d, 3d; pause after 3 failures  │
└─────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                        DATABASE                             │
│   subscriptions table (Supabase + RLS)                      │
│   payment_transactions table                                │
│   cars table (expiry_date updated on successful billing)    │
└─────────────────────────────────────────────────────────────┘
```

---

## API Endpoints

All endpoints require `Authorization: Bearer <token>` unless noted.

### Subscription Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/subscriptions` | List user's subscriptions (paginated) |
| `POST` | `/api/subscriptions` | Create subscription with immediate payment |
| `POST` | `/api/subscriptions/card-setup` | **New** — save card for valid papers (deferred billing) |
| `POST` | `/api/subscriptions/:id/tokenize` | Save card for existing subscription (bank transfer users) |
| `PUT` | `/api/subscriptions/:id/pause` | Pause auto-renewal |
| `PUT` | `/api/subscriptions/:id/resume` | Resume paused auto-renewal |
| `PUT` | `/api/subscriptions/:id/cancel` | Cancel auto-renewal |

### Payment Methods

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/payment-methods` | User's saved cards (from active subscriptions) |
| `GET` | `/api/payment-methods/pending-tokenization` | Subscriptions with no card on file yet |

### Webhooks (no auth — signature-verified)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/webhooks/paystack` | Paystack charge events |
| `POST` | `/api/webhooks/monicredit` | Monicredit payment events |

---

### `POST /api/subscriptions/card-setup`

**Use case:** User's papers are valid (> 45 days to expiry). Saves card now, charges at renewal time.

**Request:**
```json
{
  "car_slug": "toyota-camry-abc123",
  "selected_items": ["vehicle_licence", "insurance", "road_worthiness"]
}
```

`selected_items` is optional. Defaults to all required items if omitted. `vehicle_licence` is always required and cannot be excluded.

**Validation rules:**
- Car must belong to the authenticated user
- Car must have an `expiry_date` on record
- `days_until_expiry` must be > 45 (otherwise use the standard renewal flow)
- No active subscription can already exist for the car

**Success response (201):**
```json
{
  "success": true,
  "data": {
    "subscription": {
      "id": 42,
      "subscription_code": "SUB-1A2B3C-ABCD",
      "status": "pending",
      "amount": 2470000,
      "next_billing_date": "2026-12-18",
      "renewal_items": [
        { "id": "vehicle_licence", "name": "Vehicle Licence", "price": 470000 },
        { "id": "insurance", "name": "Insurance", "price": 1500000 },
        { "id": "road_worthiness", "name": "Road Worthiness", "price": 500000 }
      ]
    },
    "payment": {
      "reference": "PAY-1A2B3C-ABCD1234",
      "authorization_url": "https://checkout.paystack.com/...",
      "access_code": "..."
    }
  },
  "message": "Card setup initiated"
}
```

**Error responses:**

| Status | Reason |
|--------|--------|
| 400 | `car_slug` missing |
| 400 | Car has no expiry date on record |
| 400 | Car expires in ≤ 45 days — use renewal flow |
| 400 | Vehicle Licence not included in selected items |
| 404 | Car not found or does not belong to user |
| 409 | Car already has an active subscription |

---

## Database Schema

### `subscriptions` table (key columns)

| Column | Type | Description |
|--------|------|-------------|
| `id` | BIGSERIAL | Primary key |
| `subscription_code` | VARCHAR | Unique code e.g. `SUB-1A2B3C` |
| `user_id` | UUID | References `auth.users` |
| `car_id` | BIGINT | References `cars` |
| `status` | ENUM | `pending`, `active`, `paused`, `cancelled`, `expired` |
| `amount` | DECIMAL | Renewal amount in kobo |
| `plan` | ENUM | `annual`, `biannual`, `quarterly` |
| `next_billing_date` | DATE | Display date of first/next charge attempt |
| `authorization_code` | VARCHAR | Paystack auth code for recurring charges |
| `card_type` | VARCHAR | `visa`, `mastercard`, etc. |
| `card_last4` | VARCHAR | Last 4 digits (display only) |
| `card_exp_month` | VARCHAR | Card expiry month (string) |
| `card_exp_year` | VARCHAR | Card expiry year (string) |
| `card_bank` | VARCHAR | Issuing bank name |
| `retry_count` | INT | Failed charge attempts (0–3) |
| `last_retry_at` | TIMESTAMPTZ | Last failed charge timestamp |
| `renewal_document_ids` | JSONB | Array of item keys to renew |
| `metadata` | JSONB | Extensible — stores `pre_charge_notified_at`, `setup_source`, etc. |
| `activated_at` | TIMESTAMPTZ | When subscription became active |

### Status lifecycle

```
PENDING → (card saved via webhook) → ACTIVE
ACTIVE  → (user pauses)            → PAUSED
PAUSED  → (user resumes)           → ACTIVE
ACTIVE  → (3 charge failures)      → PAUSED (auto-billing pauses it)
ACTIVE  → (user cancels)           → CANCELLED
```

---

## Auto-Billing Job

**File:** `src/services/payment/autoBilling.service.js`  
**Schedule:** Every 60 minutes (registered in `src/index.js`)

### Charge attempt windows

The job uses the car's `expiry_date` directly — not `next_billing_date`. Charges are attempted based on how many days remain until the car expires:

| Attempt | Days before expiry | `retry_count` at time of attempt |
|---------|--------------------|----------------------------------|
| 1st | 14 days | 0 |
| 2nd | 7 days | 1 (if attempt 1 failed) |
| 3rd | 3 days | 2 (if attempts 1–2 failed) |

A subscription is only charged **once per day** — `last_retry_at` prevents re-attempts within the same day.

### Job execution flow

```
runAutoBillingJob()
    │
    ├── sendPreChargeNotifications()
    │       Finds subs with car expiry 28–31 days away
    │       Sends "we'll charge you on [date]" notification
    │       Marks metadata.pre_charge_notified_at to prevent duplicates
    │
    └── getSubscriptionsDueToday()
            Returns: status=active, auth_code IS NOT NULL, retry_count < 3
            
            For each subscription:
                ├── isCardExpired()? → skip charge, send "update card" notification
                │
                └── chargeAuthorization() via Paystack
                        Success:
                            update subscription: next_billing_date, last_billing_date, retry_count=0
                            update car: expiry_date + 1 year
                            insert payment_transaction record
                            send success notification
                        Failure:
                            increment retry_count
                            if retry_count >= 3: pause subscription, send failure notification
```

### Card expiry guard

Before every charge attempt the job checks if the saved card has expired:

```js
// Card is considered expired if:
// today.year > card_exp_year
// OR today.year == card_exp_year AND today.month > card_exp_month
```

An expired card does **not** count as a failed attempt — `retry_count` is not incremented. The user receives a notification to update their card and the next charge attempt fires on the next job run (giving them time to update).

---

## Notifications

All notifications are sent via `createInAppNotification()` and appear in the user's in-app notification centre.

| Event | Type | Message |
|-------|------|---------|
| 30 days before expiry | `auto_renewal_upcoming` | "Heads up! Auto-renewal for [car] is coming up. We'll charge ₦X on [date]." |
| Charge succeeded | `auto_renewal_success` | "Auto-renewal successful for [car]. Documents renewed for another year." |
| Charge failed (not final) | — | Logged only — user not notified for intermediate failures to avoid spam |
| 3 charges failed | `auto_renewal_failed` | "Auto-renewal failed for [car] after 3 attempts. Please update your card in Settings." |
| Saved card expired | `card_expired` | "Your saved card for [car] has expired. Please update it in Settings → Auto Renewal." |

The 30-day notification is idempotent — stored in `subscription.metadata.pre_charge_notified_at` and only fires once per billing cycle (suppressed if notified within the last 60 days).

---

## Error Handling & Retry Logic

### Failed charges

```
Day 0  (14 days before expiry): Attempt 1 — fails → retry_count = 1
Day 7  ( 7 days before expiry): Attempt 2 — fails → retry_count = 2
Day 11 ( 3 days before expiry): Attempt 3 — fails → retry_count = 3 → subscription PAUSED
```

After 3 failures the subscription is set to `PAUSED` (not cancelled). The user can resume it from Settings after updating their card.

### Partial failure resilience

- If a charge fails mid-loop (unexpected exception), the job logs the error and continues to the next subscription — one bad subscription does not block others.
- The pre-charge notification step failing does not block the charge step.
- Webhook idempotency: events are stored by ID to prevent double-processing.

### What happens if the webhook is delayed?

- Frontend polls for popup close, then invalidates the cars query.
- The subscription activates when the webhook fires (within seconds of card entry).
- If the user sees "success" before the webhook fires, the subscription will be active within seconds — the next cars query refresh will show the correct state.

---

## Security

- **Authentication:** All subscription endpoints require a valid JWT (`authenticate` middleware).
- **Email verification:** Creating and tokenizing subscriptions requires a verified email (`checkEmailVerified` middleware).
- **Rate limiting:** Payment endpoints are protected by `paymentLimiter` middleware.
- **Webhook signature verification:** Paystack webhooks are verified via HMAC-SHA512 signature. Monicredit webhooks use their own signature scheme. Both fail fast (400) if the signature is invalid.
- **Row-Level Security:** Supabase RLS ensures users can only read and write their own subscriptions. The auto-billing job uses the service role key, which bypasses RLS.
- **Card data:** Raw card numbers are never stored. Only Paystack's `authorization_code` and last-4 digits are stored. All actual card processing happens on Paystack's PCI-compliant infrastructure.
- **Ownership enforcement:** `car_id` on every subscription is double-checked against `user_id` before any operation.

---

## Testing Checklist

### Unit / logic tests

| Test | Status |
|------|--------|
| `isCardExpired()` — expired card returns true | ✅ Passed |
| `isCardExpired()` — current/future card returns false | ✅ Passed |
| `isCardExpired()` — null values return false (assume valid) | ✅ Passed |
| `addDays()` — UTC-safe, no timezone drift | ✅ Passed |
| `daysBetween()` — correct day counts across months/years | ✅ Passed |
| Pre-charge notification window (28–31 day band) | ✅ Passed |
| 45-day threshold correctly routes enable button | ✅ Passed (frontend logic) |

### API integration tests

| Test | Status |
|------|--------|
| `POST /subscriptions/card-setup` — unauthenticated returns 401 | ✅ Passed |
| `POST /subscriptions/card-setup` — invalid token returns 401 | ✅ Passed |
| Route not shadowing `POST /subscriptions` (create) | ✅ Passed |
| Route not shadowing `POST /subscriptions/:id/tokenize` | ✅ Passed |
| `PUT /subscriptions/:id/pause` still returns 401 (not broken) | ✅ Passed |
| `PUT /subscriptions/:id/resume` still returns 401 (not broken) | ✅ Passed |

### Manual end-to-end tests (run with real user account)

| Scenario | Steps |
|----------|-------|
| **Scenario B — valid papers** | 1. Register a car with expiry > 45 days. 2. Go to Settings → Auto Renewal. 3. Click Enable. 4. Verify CardSetupModal opens (not redirect to /licenses/renew). 5. Select documents. 6. Click "Add Card". 7. Complete ₦50 card entry in Paystack popup. 8. Verify popup closes → success state shown. 9. Check subscription in DB: status=active, authorization_code populated. 10. Verify ₦50 refund appears in payment history. |
| **Scenario A — pay then enable** | 1. Go through renewal flow. 2. Complete payment. 3. Verify subscription activates. 4. Go to Settings → Auto Renewal. 5. Verify card details shown. |
| **Card change** | 1. Click "Change card" in Settings. 2. Complete ₦50 verification. 3. Verify new card details shown. |
| **Pause / Resume** | 1. Toggle subscription off → status=paused. 2. Toggle back on → status=active. |
| **Cancel** | 1. Cancel subscription. 2. Verify status=cancelled. 3. Verify Enable button appears again for the car. |
| **Expiring soon path** | 1. Set car expiry to 30 days away. 2. Click Enable. 3. Verify user is sent to /licenses/renew (not modal). |

---

## File Reference

```
src/
├── controllers/payment/
│   ├── subscription.controller.js        — CRUD + tokenize endpoints
│   ├── subscriptionSetup.controller.js   — card-setup endpoint (Scenario B)
│   ├── paymentMethods.controller.js      — saved card display
│   └── webhook.controller.js             — Paystack + Monicredit webhooks
│
├── services/payment/
│   ├── autoBilling.service.js            — hourly billing job
│   ├── subscription.service.js           — DB operations for subscriptions
│   ├── paystack.service.js               — Paystack API wrapper
│   ├── renewalItems.service.js           — renewal item catalogue
│   └── transaction.service.js            — payment transaction records
│
└── routes/
    └── payment.routes.js                 — all payment + subscription routes

Motoka-frontend/src/
├── features/settings/components/
│   ├── auto-renewal-settings.jsx         — settings UI (toggle, card details, enable button)
│   └── CardSetupModal.jsx                — Scenario B modal (new)
│
└── services/
    └── apiSubscription.js                — API calls (createSubscription, setupAutoRenewal, etc.)
```
