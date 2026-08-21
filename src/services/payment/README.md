# Payment System

## Monipay (primary)

Motoka initializes and verifies payments with [Monipay](https://monipay.ng/api-docs). Do not invent upstream URLs.

| Purpose | Value |
| --- | --- |
| API | `https://api.monipay.ng` |
| Checkout | `https://checkout.monipay.ng` |
| Inline JS | `https://js.monipay.ng/v2/inline.js` |
| Initialize | `POST /transaction/initialize` (Bearer public or private key) |
| Verify | `GET /transaction/verify/{reference}` (**private key**) |
| Webhook | `POST /api/webhooks/monipay` — header `x-monipay-signature`, HMAC-SHA512 of **raw body** |

Env vars (never commit secrets):

```
MONIPAY_PUBLIC_KEY=pub_test_…
MONIPAY_SECRET_KEY=pri_test_…
MONIPAY_WEBHOOK_SECRET=          # optional; defaults to MONIPAY_SECRET_KEY
MONIPAY_CALLBACK_URL=https://app.example.com/payment/monipay/callback
PRIMARY_GATEWAY=monipay
```

Amounts are **kobo integers** (₦500.00 → `50000`). Motoka minimum is ₦100 (`10000` kobo).

Happy path: initialize → redirect to `authorization_url` or Inline JS `resumeTransaction(access_code)` → server `GET /transaction/verify/{reference}` → fulfill only when status is paid (`success` / `APPROVED`) **and** amount matches. `charge.success` webhooks use the same fulfillment, idempotently.

Merchant routes (this API): `POST /api/payments/initialize`, `GET /api/payments/verify/:reference`, `POST /api/payment/verify-payment/:reference`, `POST /api/webhooks/monipay`.

Test cards / bank transfer: use the current notes in the Monipay dashboard.

## Gateway architecture

- **Gateway abstraction** (`gateway/`) — Paystack + Monipay (Monicredit adapter kept for historical rows)
- Incoming `monicredit` on new inits is mapped to `monipay`
- Set `PRIMARY_GATEWAY` / `FALLBACK_GATEWAY` in environment variables. See `.env.example`.

### Paystack
Alternate hosted checkout (`payment_gateway: paystack`).

### Monicredit (legacy)
Existing `monicredit` transactions can still be verified. New payments do not initialize Monicredit.
