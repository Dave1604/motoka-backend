# Payment Improvements

## Paystack Verify in Webhook (Industry Standard)

**Is it industry standard to verify with the gateway API before crediting?**

Yes. Best practice is **defense in depth**:

1. **Webhook signature** – Proves the payload came from the gateway (HMAC).
2. **API verify** – Confirms the payment state with the gateway before crediting.

We already did this for Monicredit. We now do it for Paystack too. This protects against:

- Bugs in signature verification
- Replay or spoofed webhooks
- Gateway sending a webhook by mistake

**Flow:** On `charge.success`, we call Paystack's verify API. Only if it returns `status: success` and amount matches do we process the payment.

---

## SKIP_WEBHOOK_VERIFY

**What it does:** When `SKIP_WEBHOOK_VERIFY=true`, Monicredit webhook signature verification is bypassed.

**Why it exists:** For **local development only**. Paystack and Monicredit need a public URL to send webhooks. On localhost, you can't receive them. Developers often use tools like ngrok to expose localhost, but sometimes they test by manually POSTing webhooks. Without the real signature, verification would fail. `SKIP_WEBHOOK_VERIFY` lets them test locally.

**Production:** Never set this in staging or production. It disables all signature checks and is a security risk.

**Recommendation:** Keep it for local dev. Add a startup check that fails if `SKIP_WEBHOOK_VERIFY=true` and `NODE_ENV=production`.

---

## Idempotency Keys

**Purpose:** Prevent duplicate charges when the user double-clicks "Pay" or the client retries.

**Usage:** Client sends `Idempotency-Key: <unique-key>` header with `POST /api/payments/initialize`. The key should be a UUID or similar unique value per payment attempt.

**Behavior:**

- First request: Process normally, store response.
- Duplicate request (same key within 24h): Return cached response.
- Concurrent request (same key, first still processing): Return 409, ask client to retry.

**Frontend:** Generate a key per payment attempt (e.g. `crypto.randomUUID()`) and send it with the init request. Store it if you need to retry; use the same key for retries.

---

## Payment Audit Logging

**Table:** `payment_audit_log`

**Events logged:**

| Event           | When                          |
|-----------------|-------------------------------|
| `init`          | Payment initialization        |
| `verify`        | Manual verify (user callback) |
| `webhook_success` | Webhook processed success   |
| `webhook_failed`  | Webhook processed failure    |
| `refund`        | Transaction marked refunded   |

**Retention:** Keep for compliance (e.g. PCI, financial reporting). Consider a retention policy (e.g. 7 years) and archive/delete older rows.
