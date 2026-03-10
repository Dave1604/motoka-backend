# WhatsApp Notifications — Development & Testing Guide

> **Scope:** Development and sandbox testing only. This is NOT a production rollout.
> All WhatsApp logic is isolated from the existing email notification system.
> Email flows are completely unchanged.

---

## Table of Contents

1. [How It Works](#how-it-works)
2. [Twilio Sandbox Setup](#1-twilio-sandbox-setup)
3. [Joining the Sandbox](#2-joining-the-sandbox-with-a-test-number)
4. [Configure Environment Variables](#3-configure-environment-variables)
5. [Triggering Each Notification Type](#4-triggering-each-notification-type-locally)
6. [Testing the Inbound Webhook](#5-testing-the-inbound-webhook)
7. [Moving to Production](#6-moving-from-sandbox-to-production)

---

## How It Works

Three WhatsApp notification types are implemented:

| Type | Triggered by | File |
|---|---|---|
| **Expiry reminder** | Supabase Edge Function cron job | `supabase/functions/expiry-notifications/index.ts` |
| **Order update** | Admin updates order to `completed` or `cancelled` | `src/controllers/admin.controller.js` |
| **Document ready** | Admin approves a document | `src/controllers/admin.controller.js` |

**All three are:**
- Guarded by `WHATSAPP_REMINDERS_ENABLED=true` (default: `false`)
- Fire-and-forget — a WhatsApp failure never affects the email or API response
- Silent no-ops when `WHATSAPP_REMINDERS_ENABLED=false`

---

## 1. Twilio Sandbox Setup

### Create a Twilio account

1. Go to [https://www.twilio.com/try-twilio](https://www.twilio.com/try-twilio) and sign up for a free account.
2. Navigate to the **Twilio Console**: [https://console.twilio.com](https://console.twilio.com)
3. From the Console dashboard, note your:
   - **Account SID** (starts with `AC`)
   - **Auth Token** (click the eye icon to reveal)

### Activate the WhatsApp Sandbox

1. In the Console, go to **Messaging → Try it out → Send a WhatsApp message**
2. You'll see the Twilio Sandbox number (typically `+1 415 523 8886`) and a join keyword (e.g. `join shine-wood`)
3. The sandbox number is pre-configured and requires no Meta approval

---

## 2. Joining the Sandbox With a Test Number

Every phone number that should receive test messages must first join the sandbox.

**On the test phone:**

1. Open WhatsApp
2. Send the join message to the Twilio sandbox number:
   ```
   To: +14155238886
   Message: join <your-sandbox-keyword>
   ```
   (Replace `<your-sandbox-keyword>` with the keyword shown in your Twilio Console)
3. You'll receive a confirmation reply: *"You have joined the sandbox..."*

> Each sandbox session expires after ~72 hours of inactivity. If messages stop arriving, re-send the join message.

---

## 3. Configure Environment Variables

In your `.env` file, fill in the following:

```env
# Enable WhatsApp sends
WHATSAPP_REMINDERS_ENABLED=true
WHATSAPP_SANDBOX_MODE=true

# From Twilio Console → Account Info
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token_here

# The shared Twilio sandbox number (do not change for sandbox testing)
TWILIO_WHATSAPP_FROM=+14155238886
```

> The user's phone number is read from `profiles.phone_number` in the database.
> Make sure the test user has a valid E.164 phone number stored (e.g. `+2348012345678`)
> and that number has joined the sandbox.

Restart the server after changing `.env`:
```bash
npm run dev
```

---

## 4. Triggering Each Notification Type Locally

### 4a. Order Update (completed / cancelled)

1. Create a payment and a renewal order via the normal app flow (or use the admin panel)
2. In the admin panel (or via API), update the order status to `completed` or `cancelled`
3. The WhatsApp message fires alongside the existing completion email

**API call example:**
```http
PUT /api/admin/orders/:orderNumber/status
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "status": "completed"
}
```

**Expected WhatsApp message:**
```
Motoka Update 🚗 Hi John, your order #ORD-ABC123 status is: completed.
```

---

### 4b. Document Ready (admin approves a document)

1. Upload a document as a user (via `POST /api/documents/upload`)
2. In the admin panel, approve the document via:

```http
PUT /api/admin/documents/:id/approve
Authorization: Bearer <admin_token>
```

3. The WhatsApp message fires with the document URL

**Expected WhatsApp message:**
```
Motoka Update 🚗 Hi John, your documents for 2020 Toyota Camry are ready. Download here: https://...
```

---

### 4c. Expiry Reminder (cron / Edge Function)

The expiry reminder runs via a Supabase Edge Function cron job. To trigger it locally:

**Option A — invoke directly via Supabase CLI:**
```bash
supabase functions serve expiry-notifications --env-file .env
curl -X POST http://localhost:54321/functions/v1/expiry-notifications \
  -H "Authorization: Bearer <supabase_anon_key>"
```

**Option B — set a car's `expiry_date` to trigger window:**

In Supabase SQL editor, set a test car's expiry to 7, 14, or 30 days from today:
```sql
UPDATE cars
SET expiry_date = (NOW() + INTERVAL '7 days')::date::text
WHERE id = <your_test_car_id>;
```

Then invoke the Edge Function. The WhatsApp reminder fires after the email.

**Expected WhatsApp message:**
```
Motoka Reminder 🚗 Hi John, your vehicle licence for ABC-123-XY expires in 7 days (2026-03-17). Renew here: http://localhost:3001/licenses/renew
```

> **Note:** The `FRONTEND_URL` env var is used to build the renewal URL in the Edge Function.
> Set it to `http://localhost:3001` (or your local frontend port) for testing.

---

## 5. Testing the Inbound Webhook

The route `POST /api/v1/whatsapp/webhook` receives replies from sandbox users.

**Set up ngrok (or any tunnel):**
```bash
ngrok http 3000
```

**Configure the Twilio Sandbox webhook URL:**
1. In Twilio Console → Messaging → Try it out → WhatsApp
2. Under **"When a message comes in"**, set the URL to:
   ```
   https://<your-ngrok-id>.ngrok.io/api/v1/whatsapp/webhook
   ```
3. Method: **HTTP POST**

Now when a sandbox user replies to any message, the log will show:
```
[WhatsApp][SANDBOX] Inbound message received { from: 'whatsapp:+2348012345678', body: 'Hello', ... }
```

> This webhook is only active in `NODE_ENV !== production`. It is automatically disabled in production builds.

---

## 6. Moving from Sandbox to Production

When ready to go live with real WhatsApp Business messaging, complete the following steps:

### Step 1 — Get a WhatsApp Business number approved by Meta

1. Apply for a WhatsApp Business Profile in Twilio Console → Messaging → Senders → WhatsApp Senders
2. Submit for Meta review (takes 1–5 business days)
3. Once approved, your sender number appears in the Console

### Step 2 — Get message templates approved by Meta

Freeform messages are only allowed in the sandbox. For production, WhatsApp requires pre-approved templates for outbound (business-initiated) messages.

Submit templates in Twilio Console that match these message patterns:
- Expiry reminder
- Order update
- Document ready

> Look for `// TODO: production migration` comments in the codebase — these mark every point that needs updating.

### Step 3 — Update environment variables

```env
WHATSAPP_REMINDERS_ENABLED=true
WHATSAPP_SANDBOX_MODE=false
TWILIO_WHATSAPP_FROM=+234XXXXXXXXXX  # Your approved WhatsApp Business number
```

### Step 4 — Add WhatsApp opt-in to user profile

Currently, the service sends to all users who have a phone number. Before production, add an opt-in field:

```sql
ALTER TABLE public.profiles ADD COLUMN whatsapp_opt_in BOOLEAN NOT NULL DEFAULT FALSE;
```

Then uncomment the opt-in checks (search for `TODO: implement opt-in field check` in the codebase).

### Step 5 — Add Twilio signature validation to the webhook route

In `src/routes/whatsapp.routes.js`, add:
```js
import twilio from 'twilio';
router.post('/webhook', twilio.webhook(), (req, res) => { ... });
```

This validates that inbound webhooks genuinely come from Twilio.

### Step 6 — Enable the webhook in production

In `src/index.js`, remove or update the `NODE_ENV !== 'production'` guard around the WhatsApp route.

---

## Files Reference

| File | Role |
|---|---|
| `src/services/whatsapp/whatsapp.service.js` | Core service — Twilio client, 3 send functions, feature flag |
| `src/routes/whatsapp.routes.js` | Dev-only inbound webhook route |
| `src/controllers/admin.controller.js` | Order update + document ready hooks |
| `supabase/functions/expiry-notifications/index.ts` | Expiry reminder hook (Deno, Twilio REST) |
| `.env` | Local credentials (not committed) |
| `env.example` | Template with all WhatsApp vars documented |
