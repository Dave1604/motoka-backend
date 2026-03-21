# Motoka — Full-Stack Security & Code Audit Report

**Date:** March 11, 2026
**Auditor:** Senior Full-Stack Review (Claude Code)
**Scope:** motoka-backend (Node.js/Express/Supabase) + Motoka-frontend (React/Vite)
**Files Reviewed:** ~227 frontend files + entire backend source

---

## Executive Summary

You're building a government-adjacent vehicle registration and licensing platform for Nigeria. That means you're handling PII, financial transactions, and government-issued documents. The bar for security is not "startup quality" — it's closer to fintech/govtech.

**The honest assessment:** The codebase shows genuine effort. The architecture isn't amateur — you've implemented 2FA, rate limiting, Helmet headers, webhook signature verification, structured logging with sensitive data redaction, and RLS on Supabase. That's more than most junior projects have.

**But there are critical, ship-blocking issues.** Two of them can result in real financial fraud today. One means anyone who finds your repo can make API calls as your service. If any of these are live in production right now, stop and fix them before anything else.

---

## CRITICAL — Fix Before Shipping Anything

### CRIT-1: Live Credentials Committed to Git

**File:** `motoka-backend/.env`
**File:** `Motoka-frontend/.env.production`

Your `.env` file is tracked in git. It contains **live, working credentials**:

- `MONICREDIT_PUBLIC_KEY` / `MONICREDIT_PRIVATE_KEY` — these are **LIVE** keys (`PUB_LIVE_*`, `PRI_LIVE_*`), not test keys
- `MONICREDIT_WEBHOOK_SECRET` — the secret used to verify payment webhooks
- `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` — allows sending messages billed to your account
- `RESEND_API_KEY` — allows sending emails as your domain
- `SUPABASE_SERVICE_ROLE_KEY` — **bypasses all Row Level Security**, gives full database access
- `JWT_SECRET` — allows forging admin authentication tokens
- `PAYSTACK_SECRET_KEY` — test keys (sk_test_), lower risk but still exposed

The frontend `.env.production` also has your Supabase URL and anon key committed.

**What an attacker can do right now:**
1. Call Monicredit as your merchant — fake payment verifications, reverse real ones
2. Send unlimited WhatsApp/SMS on your Twilio bill
3. Send phishing emails as `no-reply@motokaapp.ng` via Resend
4. Use the `SUPABASE_SERVICE_ROLE_KEY` to read or delete your entire user database
5. Forge admin JWTs and authenticate to your admin panel without credentials

**What you must do — in this order:**

1. **Immediately rotate every key listed above.** Don't wait to clean git history first. Revoke them now.
2. Remove `.env` and `.env.production` from git tracking:
   ```bash
   echo ".env" >> .gitignore
   echo ".env.production" >> .gitignore
   git rm --cached .env
   git rm --cached .env.production  # in frontend
   ```
3. Purge from git history:
   ```bash
   # Install git-filter-repo first: pip install git-filter-repo
   git filter-repo --path .env --invert-paths --force
   ```
4. Force-push and notify all collaborators to re-clone.
5. Set environment variables through your hosting platform (Render dashboard, Vercel, etc.), never in files.

This is not optional. Everything else in this report is secondary to this.

---

### CRIT-2: Webhook Signature Verification Disabled in Production Config

**File:** `src/middleware/verifyMonicreditWebhook.js`
**Env:** `.env` line 55: `SKIP_WEBHOOK_VERIFY=true`

```javascript
const skipVerify = process.env.SKIP_WEBHOOK_VERIFY === 'true';
if (skipVerify) {
  return next(); // no signature check at all
}
```

And in your `.env`: `SKIP_WEBHOOK_VERIFY=true`.

This means **your payment webhook endpoint currently accepts any request as a valid Monicredit webhook** — no signature required. Someone can POST `{"status": "success", "reference": "abc123"}` to your webhook URL and your system will mark a payment as complete.

This is how people get defrauded. If this backend is deployed anywhere with this env variable set, fraudulent payments can be credited right now.

**Fix:** Remove `SKIP_WEBHOOK_VERIFY=true` from your `.env`. Never ship this flag as `true`.

---

### CRIT-3: Refresh Tokens Stored in Plain localStorage

**Files:** `Motoka-frontend/src/services/apiAuth.js`, `src/utils/authStorage.js`, `src/features/auth/useOTPAuth.js`

```javascript
localStorage.setItem('refresh_token', refreshTokenValue);
```

Refresh tokens are long-lived. Storing them in `localStorage` means any JavaScript running on your page — including third-party scripts, browser extensions, or XSS payloads — can steal them. An attacker who steals a refresh token can silently stay logged in as that user indefinitely.

The access token has some CryptoJS encryption applied. That is theater. CryptoJS is not a security boundary. The encryption key (`VITE_CRYPTO_SECRET`) is in your client bundle — anyone who can read your JavaScript can decrypt the token. Client-side encryption of auth tokens provides zero real protection.

**The correct approach:** Store tokens in `httpOnly`, `Secure`, `SameSite=Strict` cookies. The server sets them; JavaScript cannot read them. This requires changes on both the backend (set cookie on login response) and frontend (remove all localStorage token logic).

This is architecturally significant to fix, but it's the right approach for a platform handling government documents and payments.

---

### CRIT-4: Payment Status Trusted from Client-Side URL Parameters

**File:** `Motoka-frontend/src/features/payment/PaystackPayment.jsx`

```javascript
const reference = urlParams.get("reference");
const status = urlParams.get("status");

if (reference && status === "success") {
  handlePaymentSuccess(reference);
}
```

The `status=success` in the URL is set by Paystack's redirect. A user can manually type `?reference=anything&status=success` in the URL bar and trigger `handlePaymentSuccess`.

Payment verification **must happen server-side**. The backend should call Paystack's verify endpoint to confirm the transaction, check the amount matches what was expected, and only then update the order. The frontend should only display a result — it should never decide whether a payment succeeded.

Also: `localStorage.setItem('recentPayments', JSON.stringify(recentPayments))` — storing payment history in localStorage is unnecessary and adds attack surface.

---

## HIGH — Fix Before Launch

### HIGH-1: Password Reset Token Uses Math.random()

**File:** `src/controllers/auth.controller.js`

```javascript
const resetToken = Array.from({ length: 64 }, () =>
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    .charAt(Math.floor(Math.random() * 62))
).join('');
```

`Math.random()` is not cryptographically secure. Its output is predictable if an attacker knows the seed or can observe multiple outputs. For a password reset token that grants account access, this is a real vulnerability.

**Fix:** `crypto.randomBytes(32).toString('hex')` — one line, proper entropy.

---

### HIGH-2: User PII Stored Unencrypted in localStorage

**File:** `Motoka-frontend/src/features/auth/useAuth.js`

```javascript
localStorage.setItem("userInfo", JSON.stringify({
  name: data.user.name,
  email: data.user.email,
  phone_number: data.user.phone_number,
  ...
}));
```

Name, email, phone number — all sitting in plaintext in `localStorage`. Also stored in Zustand's persisted store. You have this data in at least 3 separate localStorage keys across the codebase.

For a platform where users are submitting NIN numbers, vehicle registration data, and government documents, this is not acceptable. Keep only what you absolutely need in client-side storage, and never persist PII there.

---

### HIGH-3: Token Refresh Race Condition

**File:** `Motoka-frontend/src/services/apiClient.js`

When multiple requests return 401 simultaneously, each triggers a token refresh. The `_retry` flag is per-request, not global. You will get multiple simultaneous refresh calls, potentially invalidating each other's tokens, causing the user to be logged out mid-session.

This is a solvable pattern: queue failed requests behind a single refresh promise, resolve them all when the refresh completes. The current code doesn't do this.

---

### HIGH-4: PostMessage Origin Not Validated in Payment Flow

**File:** `Motoka-frontend/src/features/payment/usePaystackPayment.js`

```javascript
window.addEventListener('message', (event) => {
  if (event.data.type === 'PAYMENT_SUCCESS') {
    verifyPayment(event.data.reference);
  }
});
```

No `event.origin` check. Any window (iframe, popup) can post `{ type: 'PAYMENT_SUCCESS', reference: 'fake' }` to your page and trigger payment verification. Always check `event.origin === 'https://paystack.com'` before trusting a postMessage.

---

### HIGH-5: OAuth Callback Has No State Parameter Validation

**File:** `Motoka-frontend/src/App.jsx`

```javascript
const params = new URLSearchParams(hash.substring(1));
const accessToken = params.get("access_token");
```

The OAuth callback processes tokens directly from the URL hash without validating a `state` parameter. Without CSRF state validation, this is vulnerable to token injection attacks. PKCE is also not implemented. These are baseline requirements for OAuth 2.0 security.

---

### HIGH-6: In-Memory Profile Cache Has No Upper Bound Enforcement

**File:** `src/middleware/authenticate.js`

```javascript
if (profileCache.size > 10000) {
  const entries = Array.from(profileCache.entries());
  entries.sort((a, b) => a[1].expiresAt - b[1].expiresAt);
  entries.slice(0, 2000).forEach(([key]) => profileCache.delete(key));
}
```

The cache can grow to 10,000 entries before cleanup, and the cleanup itself — sorting 10,000 entries — is O(n log n) and runs on every request during a burst. Under load, this can spike memory and CPU simultaneously. A Node.js process with 10,000 cached profiles is holding significant memory.

The comment in your code says "TODO: migrate to Redis." Do it. This is not optional for production. If Redis is not available immediately, use a proper LRU library (`lru-cache`) with a hard size limit.

---

## MEDIUM — Fix Before Real Users

### MED-1: CORS `ALLOWED_ORIGINS` Not Set in .env

**File:** `src/config/cors.config.js`

Your `.env` has no `ALLOWED_ORIGINS` defined. Your CORS config defaults to some permissive behavior in this case. In production you must explicitly set this to your frontend domain only (`https://motokaapp.ng` or whatever it is). Not having it set is accepting unknown behavior.

---

### MED-2: Rate Limiter Trusts localhost IP — Can Be Spoofed via X-Forwarded-For

**File:** `src/middleware/rateLimiter.js`

```javascript
skip: (req) => {
  const ip = req.ip || req.connection?.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}
```

If your server is behind a proxy (Render, Nginx, etc.), `req.ip` is determined by `X-Forwarded-For`. If `trust proxy` is not configured correctly, an attacker can send `X-Forwarded-For: 127.0.0.1` and bypass all rate limiting on auth endpoints. This means unlimited login attempts, OTP spraying, password reset spam — everything you built rate limiting to prevent.

---

### MED-3: Zustand Auth Store Also Persisted to localStorage

**File:** `Motoka-frontend/src/features/auth/authStore.js`

```javascript
{
  name: 'auth-storage',
  storage: createJSONStorage(() => localStorage),
  partialize: (state) => ({ token: state.token, user: state.user, isAuthenticated: state.isAuthenticated }),
}
```

You now have tokens stored in:
1. `auth-storage` (Zustand → localStorage)
2. `access_token` (authStorage.js → localStorage, encrypted with a key that's also in localStorage)
3. `refresh_token` (plain localStorage)
4. `userInfo` (plain localStorage)

This is four separate storage mechanisms for the same auth data. They can fall out of sync. If a user clears one but not others, you get ghost sessions. If there's an XSS vulnerability, an attacker has four places to exfiltrate from. Consolidate.

---

### MED-4: isAuthenticated() Checks Field Names, Not Token Expiry

**File:** `Motoka-frontend/src/utils/authStorage.js`

```javascript
isAuthenticated: () => {
  return userInfo?.email_verified ||
         userInfo?.verified ||
         userInfo?.is_verified ||
         userInfo?.email_verified_at !== null ||
         false;
}
```

This is checking whether the user's email is verified — not whether the session is still valid. A user whose token expired an hour ago but whose `userInfo.email_verified` is `true` in localStorage would be considered "authenticated" by this function. This needs to check token expiry.

---

### MED-5: Pagination Parameters Not Validated in Admin Controller

**File:** `src/controllers/admin.controller.js`

```javascript
const offset = (parseInt(page) - 1) * parseInt(limit);
```

No bounds checking. `page=0` gives `offset=-limit`. `limit=999999` returns your entire user table. Add min/max bounds: page ≥ 1, limit between 1 and 100.

---

### MED-6: 155 console.log Statements in Frontend

You have `vite-plugin-remove-console` installed, which strips console statements from production builds. Good. But during development, you're logging tokens, user data, API responses, and error objects. This creates habits and means your development logs are full of sensitive data. Clean it up — use your logger properly or at minimum restrict what you log.

---

### MED-7: Dead Code at Scale

**Files:** `Signin.jsx` (lines 1–358 commented), `Signup.jsx` (lines 1–303 commented), `apiTwoFactor.js`, `usePayment.js` (entire hook commented out)

You have hundreds of lines of commented-out code. This is a maintenance burden, a confusion source for any future developer (or yourself in 6 months), and signals that the codebase went through significant rewrites without cleanup. Delete it. You have git history for a reason.

---

### MED-8: File Upload Validation is Client-Side Only

**File:** `Motoka-frontend/src/components/FileUpload.jsx`

MIME type and extension validation happens in the browser. This is UX, not security. A malicious user can modify the request and upload any file type. Your backend must re-validate file type on receipt, preferably by reading the file's magic bytes, not trusting the `Content-Type` header.

---

### MED-9: No CSRF Token on State-Changing API Calls

The API client sends JWTs in `Authorization` headers. That protects against CSRF if done correctly because cookies are not being used. But given you're also storing things in cookies (`js-cookie` is in your dependencies), verify that no state-changing operations rely solely on cookie-based auth without CSRF protection.

---

## LOW — Technical Debt & Code Quality

### LOW-1: Duplicate Admin Verification Logic

`src/middleware/checkAdmin.js` and `src/middleware/authenticateAdmin.js` both implement variations of admin auth checking. These should be one module.

---

### LOW-2: Error Responses Return Wrong HTTP Status Codes

Several controllers return 500 for what should be 400/422 (validation errors) or 404 (not found). This breaks HTTP semantics and makes client error handling harder. Establish a standard error response shape and stick to it across all routes.

---

### LOW-3: Tesseract.js Loads ML Models from the Internet at Runtime

**Dependency:** `tesseract.js@6.0.1`

Tesseract downloads OCR models from a CDN when first used. In a production environment this is a network dependency you don't control, adds latency for first use, and means your app breaks if the CDN is down or changes their URLs. Either bundle the models or consider a server-side OCR approach.

---

### LOW-4: External Image from SVGRepo (No SRI)

**File:** `Motoka-frontend/src/features/auth/Signin.jsx`

```javascript
<img src="https://www.svgrepo.com/show/475656/google-color.svg" />
```

An external CDN you don't control. If svgrepo.com is compromised or changes the image, your login page is affected. Bundle the SVG or use Subresource Integrity (SRI) hashes for any external resource. This is minor but sloppy for a production app.

---

### LOW-5: No Test Coverage

**Backend:** `package.json` has Jest configured but no test files for controllers, services, or middleware. The test script exists, the framework is there, nothing is tested.
**Frontend:** No test framework installed at all.

For a platform processing ₦500,000+ vehicle registration payments, you have no automated verification that your payment flow works, your auth logic is correct, or your data transformations don't corrupt records. This is a serious operational risk. One refactor away from a regression that costs a user real money.

---

### LOW-6: WhatsApp Still on Sandbox Number

**File:** `.env`
`TWILIO_WHATSAPP_FROM=+14155238886` — this is Twilio's shared sandbox number.

The TODO comment is in the code. Users will receive WhatsApp messages from a random shared Twilio number that looks like spam. This needs a registered WhatsApp Business number before launch.

---

### LOW-7: speakeasy is Unmaintained

**Dependency:** `speakeasy@^2.0.0`

Speakeasy has not been maintained in years (last publish was 2017). It still works for TOTP, but it has known issues that will never be fixed. Consider `@otplib/preset-default` as a maintained alternative.

---

### LOW-8: Backend on Render Free Tier (Implied)

`VITE_API_BASE_URL=https://motoka-backend.onrender.com/api`

Render's free tier spins down after 15 minutes of inactivity, causing 30–60 second cold starts. For a vehicle registration platform where users are paying money, a 60-second hang after clicking "Pay Now" is unacceptable. If you're on a paid tier, ignore this. If not, upgrade or move.

---

## Architecture Assessment

### What's Actually Good

- **Helmet.js configured** with CSP, HSTS, X-Frame-Options — you thought about HTTP security headers
- **Rate limiting** is implemented per-endpoint with different limits — this is correct
- **2FA with TOTP + Email OTP** — proper dual-factor support, not just OTP
- **OTP hashing with SHA-256** before database storage — correct
- **Webhook signature verification** code exists and is correct in structure (just disabled)
- **Structured logging with sensitive data redaction** — password/token fields are redacted in logs
- **Supabase RLS** — you're using Row Level Security, not bypassing it everywhere
- **JWT expiry: 1hr user / 30min admin** — reasonable TTLs
- **Input validation with express-validator** — consistently applied
- **Admin suspension check** on every request — thought about operational security
- **Supabase Edge Functions** for expiry notifications — correct architecture for scheduled work
- **React Query (TanStack)** for server state — right tool for the job

### What Needs Rethinking

**The token architecture is a mess.** You have access tokens, refresh tokens, registration tokens, admin JWTs, and Supabase JWTs — all stored in different places (localStorage, Zustand, component state, cookies) with different strategies. This evolved organically and it shows. Before launch, draw a clear diagram of what tokens exist, where they live, what their TTL is, and how they're invalidated. Then implement that consistently.

**No separation between dev and prod configs.** Your production environment variables are committed and identical to development ones. You need a proper secrets management strategy: production secrets only in your hosting platform's environment settings, never in any file.

**Payment flow control is split across frontend and backend without clear ownership.** The frontend is making decisions it shouldn't (trusted URL params for payment status). The backend webhook is disabled. The result is a payment flow where neither layer is actually enforcing correctness.

**Zero tests means zero confidence in refactoring.** Every feature you add increases the risk of breaking existing functionality silently.

---

## Risk Summary Table

| ID | Issue | Severity | Status |
|----|-------|----------|--------|
| CRIT-1 | Live credentials in git | **CRITICAL** | Must fix now |
| CRIT-2 | Webhook verification disabled | **CRITICAL** | Must fix now |
| CRIT-3 | Refresh tokens in localStorage | **CRITICAL** | Must fix before launch |
| CRIT-4 | Payment status from URL params | **CRITICAL** | Must fix before launch |
| HIGH-1 | Math.random() for reset tokens | **HIGH** | Must fix before launch |
| HIGH-2 | User PII in localStorage | **HIGH** | Must fix before launch |
| HIGH-3 | Token refresh race condition | **HIGH** | Must fix before launch |
| HIGH-4 | postMessage origin not checked | **HIGH** | Must fix before launch |
| HIGH-5 | No OAuth state validation | **HIGH** | Must fix before launch |
| HIGH-6 | In-memory cache, no hard limit | **HIGH** | Must fix before launch |
| MED-1 | ALLOWED_ORIGINS not configured | **MEDIUM** | Fix before launch |
| MED-2 | Rate limiter localhost bypass | **MEDIUM** | Fix before launch |
| MED-3 | 4 separate auth storage locations | **MEDIUM** | Fix before launch |
| MED-4 | isAuthenticated() checks wrong thing | **MEDIUM** | Fix before launch |
| MED-5 | Pagination no bounds validation | **MEDIUM** | Fix before launch |
| MED-6 | 155 console.log statements | **MEDIUM** | Clean up |
| MED-7 | Hundreds of lines of dead code | **MEDIUM** | Clean up |
| MED-8 | File upload client-side only | **MEDIUM** | Fix before launch |
| LOW-1 | Duplicate admin check logic | **LOW** | Tech debt |
| LOW-2 | Wrong HTTP status codes | **LOW** | Tech debt |
| LOW-3 | Tesseract fetches models at runtime | **LOW** | Consider |
| LOW-4 | External SVG no SRI | **LOW** | Minor |
| LOW-5 | Zero test coverage | **LOW** | Ongoing debt |
| LOW-6 | WhatsApp sandbox number | **LOW** | Pre-launch |
| LOW-7 | speakeasy unmaintained | **LOW** | Eventually |
| LOW-8 | Render cold starts | **LOW** | Operational |

---

## Immediate Action Checklist (Do This Today)

- [ ] **Rotate every credential in your `.env` file** — Monicredit, Twilio, Resend, Supabase service role key, Paystack, JWT secret
- [ ] **Remove `.env` files from git tracking** — `git rm --cached .env` on both repos
- [ ] **Purge git history** — `git filter-repo --path .env --invert-paths`
- [ ] **Set `SKIP_WEBHOOK_VERIFY=false`** or remove the variable entirely
- [ ] **Move all secrets to Render/hosting platform** environment variable settings
- [ ] **Verify your Monicredit LIVE keys are not currently being misused** — check transaction logs

Everything else can be scheduled. These cannot.

---

## Final Assessment

You've built something real. The feature set is ambitious — dual payment gateways, government document management, 2FA, expiry notifications, admin panels. That's not nothing.

But the security fundamentals have gaps that, on a platform touching government identity documents and payments of ₦500,000+, are not acceptable. The credential exposure alone is a liability. The disabled webhook verification combined with a client-trusting payment flow means your payment logic is not enforcing correctness at any layer right now.

The frontend auth architecture needs a ground-up rethink around token storage. The "encrypt it with CryptoJS in localStorage" approach is not a security measure — it's a false sense of security. Pick one approach (httpOnly cookies), implement it correctly, and delete everything else.

Get the critical issues fixed. Then build tests as you fix things so you don't regress. Then tackle the medium issues. You'll have a solid foundation.

---

*This report was generated from a full read of all source files. No code was modified.*
