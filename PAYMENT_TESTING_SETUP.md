# Payment Testing Setup Guide

## ✅ Step 1: Verify Database Migrations

**Go to Supabase Dashboard:**
1. Open: https://supabase.com/dashboard/project/ucvnkouowpghnffvxrnb
2. Click "SQL Editor" in the left sidebar
3. Click "New Query"
4. Copy and paste this SQL:

```sql
-- Check if payment tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN (
  'payment_transactions',
  'renewal_orders',
  'payment_subscriptions',
  'renewal_items',
  'webhook_events',
  'states',
  'lgas'
)
ORDER BY table_name;
```

5. Click "Run"

**Expected Result (if migrations are successful):**
You should see **7 tables**:
- lgas
- payment_subscriptions
- payment_transactions
- renewal_items
- renewal_orders
- states
- webhook_events

**If you see fewer than 7 tables**, the migrations haven't been run yet.

### To Run Migrations (if needed):

**Option A: Via Supabase Dashboard (easiest)**
1. Go to SQL Editor
2. For each migration file (in order 015-025), copy the contents and run
3. Start with `015_payment_system.sql` and go sequentially to `025_fix_rpc_ambiguous_transaction_id.sql`

**Option B: Via Supabase CLI** (if you have it installed)
```bash
cd /Users/mac/Documents/Motoka/backend
supabase db push
```

---

## 🔧 Step 2: Webhook Testing Options

### Option 1: ngrok (RECOMMENDED for local testing) ⭐

**What is ngrok?**
- Creates a secure tunnel from internet to your localhost
- Gives you a public HTTPS URL that forwards to localhost:3000
- Perfect for testing webhooks locally

**Setup:**
1. Install ngrok:
   ```bash
   # Via Homebrew (recommended for Mac)
   brew install ngrok/ngrok/ngrok
   
   # Or download from: https://ngrok.com/download
   ```

2. Sign up for free account at: https://dashboard.ngrok.com/signup
   - Free tier is perfect for testing
   - Get your authtoken from: https://dashboard.ngrok.com/get-started/your-authtoken

3. Configure authtoken:
   ```bash
   ngrok config add-authtoken YOUR_AUTH_TOKEN_HERE
   ```

4. Start your backend server:
   ```bash
   cd /Users/mac/Documents/Motoka/backend
   npm start
   ```

5. In a NEW terminal, start ngrok:
   ```bash
   ngrok http 3000
   ```

6. You'll see output like:
   ```
   Forwarding  https://abc123def456.ngrok-free.app -> http://localhost:3000
   ```

7. Your webhook URL will be:
   ```
   https://abc123def456.ngrok-free.app/api/webhooks/paystack
   ```

**Pros:**
- ✅ Free and easy
- ✅ HTTPS by default (Paystack requires this)
- ✅ Shows webhook requests in real-time
- ✅ Web interface to inspect requests: http://localhost:4040

**Cons:**
- ⚠️ URL changes each time you restart (free tier)
- ⚠️ Need to update webhook URL in Paystack each session
- ⚠️ 40 requests/minute limit (enough for testing)

---

### Option 2: LocalTunnel (Alternative)

**Setup:**
```bash
npm install -g localtunnel
lt --port 3000 --subdomain motoka-test
```

**Pros:**
- ✅ Simple npm package
- ✅ Can request custom subdomain

**Cons:**
- ⚠️ Sometimes unreliable
- ⚠️ No request inspection
- ⚠️ Less secure than ngrok

---

### Option 3: Cloudflare Tunnel (Advanced)

**Setup:**
```bash
# Install cloudflared
brew install cloudflare/cloudflare/cloudflared

# Run tunnel
cloudflared tunnel --url http://localhost:3000
```

**Pros:**
- ✅ From Cloudflare (very reliable)
- ✅ Good performance

**Cons:**
- ⚠️ More complex setup
- ⚠️ Overkill for simple testing

---

### Option 4: Deploy to Render with TEST keys (Hybrid Approach)

**Setup:**
- Add test keys to Render environment
- Test on your live backend URL: `https://motoka-backend.onrender.com`
- Switch to live keys later

**Pros:**
- ✅ No tunneling needed
- ✅ Stable URL
- ✅ Same as production environment

**Cons:**
- ⚠️ Redeploy needed for code changes
- ⚠️ Uses your Render hours
- ⚠️ Harder to debug

---

## 🎯 Recommendation: Use ngrok

For testing, I recommend **ngrok** because:
1. Easy to set up (5 minutes)
2. Real-time webhook inspection
3. Works exactly like production
4. Free tier is sufficient

**Workflow:**
1. Develop locally with ngrok
2. Test webhook with Paystack test keys
3. Once working, deploy to Render with live keys

---

## 🔑 Step 3: Get Paystack Test Keys

1. Go to: https://dashboard.paystack.com/#/settings/developers
2. Switch to **"Test Mode"** (toggle at top right)
3. Copy these keys:
   - **Test Secret Key** (starts with `sk_test_`)
   - **Test Public Key** (starts with `pk_test_`)

**IMPORTANT**: 
- ✅ Test keys can only process test transactions
- ✅ No real money is charged
- ✅ Perfect for development

---

## 📝 Step 4: Add Test Keys to Local .env

Update your `/Users/mac/Documents/Motoka/backend/.env`:

```env
# Paystack TEST Keys (for local development)
PAYSTACK_SECRET_KEY=sk_test_YOUR_TEST_SECRET_KEY_HERE
PAYSTACK_PUBLIC_KEY=pk_test_YOUR_TEST_PUBLIC_KEY_HERE

# Payment URLs (for ngrok testing - update with your ngrok URL)
PAYMENT_CALLBACK_URL=http://localhost:3001/payment/callback
PAYMENT_SUCCESS_URL=http://localhost:3001/payment/success
PAYMENT_CANCEL_URL=http://localhost:3001/payment/cancel
```

**Note**: The callback URLs point to your frontend localhost since that's where users return after payment.

---

## 🌐 Step 5: Configure Paystack Webhook

### For Local Testing (with ngrok):

1. Start ngrok (see Step 2)
2. Get your ngrok URL: `https://abc123def456.ngrok-free.app`
3. Go to Paystack Dashboard → Settings → Developers → Webhooks
4. Click "Add Webhook"
5. **Webhook URL**: `https://abc123def456.ngrok-free.app/api/webhooks/paystack`
6. **Events**: Select:
   - ✅ `charge.success`
   - ✅ `charge.failed`
7. Click "Save"

**Important**: You'll need to update this URL each time you restart ngrok (free tier).

### For Production Testing (with Render + test keys):

**Webhook URL**: `https://motoka-backend.onrender.com/api/webhooks/paystack`

---

## 🧪 Step 6: Test Payment Flow

### 6.1 Start Services

**Terminal 1 - Backend:**
```bash
cd /Users/mac/Documents/Motoka/backend
npm start
```

**Terminal 2 - ngrok:**
```bash
ngrok http 3000
```

**Terminal 3 - Frontend:**
```bash
cd /Users/mac/Documents/Motoka-frontend
npm run dev
```

### 6.2 Initialize Test Payment

Use Postman or curl:

```bash
curl -X POST http://localhost:3000/api/payments/initialize \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_USER_JWT_TOKEN" \
  -d '{
    "car_slug": "your-test-car-slug",
    "payment_schedule_id": ["vehicle_licence"],
    "renewal_months": 12,
    "delivery_details": {
      "address": "123 Test Street",
      "state": "Lagos",
      "lga": "Ikeja",
      "contact": "+2348012345678"
    }
  }'
```

**Response will include:**
```json
{
  "status": true,
  "message": "Payment initialized successfully",
  "data": {
    "reference": "PAY-xxx",
    "authorization_url": "https://checkout.paystack.com/xxx",
    "access_code": "xxx",
    "amount": 470000
  }
}
```

### 6.3 Complete Payment on Paystack

1. Open `authorization_url` in browser
2. Use Paystack test card:
   - **Card**: `4084 0840 8408 4081`
   - **CVV**: `408`
   - **Expiry**: `12/30` (any future date)
   - **PIN**: `0000`

### 6.4 Monitor Webhook

**In ngrok web interface** (http://localhost:4040):
- You'll see the webhook POST request from Paystack
- Inspect the payload and response

**In your backend logs**:
- You'll see: `[Webhook] Received event: charge.success`
- Order creation logs

### 6.5 Verify Payment

```bash
curl -X GET http://localhost:3000/api/payments/verify/PAY-xxx \
  -H "Authorization: Bearer YOUR_USER_JWT_TOKEN"
```

**Expected Response:**
```json
{
  "status": true,
  "message": "Payment verified successfully",
  "data": {
    "transaction": { ... },
    "order": { ... }
  }
}
```

---

## 🐛 Debugging Tips

### Check Backend Logs:
```bash
# Backend should show:
[Webhook] Received event: charge.success Event ID: evt_xxx
[Webhook] Processing charge.success: PAY-xxx
Transaction updated successfully
Order created: ORD-xxx
```

### Check ngrok Requests:
- Open: http://localhost:4040
- See all requests in real-time
- Inspect webhook payload and response

### Check Database:
```sql
-- In Supabase SQL Editor:
SELECT * FROM payment_transactions ORDER BY created_at DESC LIMIT 5;
SELECT * FROM renewal_orders ORDER BY created_at DESC LIMIT 5;
```

### Common Issues:

**"Invalid signature"**
- Check that webhook middleware is using correct secret key
- Ensure `express.raw()` is applied before signature verification

**"Transaction not found"**
- Check that transaction was created in initialize step
- Verify reference matches

**"Order not created"**
- Check webhook was received (in ngrok dashboard)
- Check backend logs for errors
- Verify RLS policies allow service role

---

## 📋 Testing Checklist

Before going live, test these scenarios:

- [ ] Initialize payment successfully
- [ ] Complete payment with test card
- [ ] Webhook receives `charge.success`
- [ ] Transaction status updated to "successful"
- [ ] Order created automatically
- [ ] Payment verification returns correct data
- [ ] User can view order in order history
- [ ] Email sent (check Resend dashboard)
- [ ] Receipt can be retrieved
- [ ] Failed payment scenario (use test card `4084 0840 8408 4081` with wrong PIN)
- [ ] Webhook receives `charge.failed`
- [ ] Transaction status updated to "failed"
- [ ] Duplicate webhook ignored (idempotency)
- [ ] Payment cancellation works
- [ ] Payment retry works

---

## 🚀 When Ready for Production

1. **Switch to Paystack Live Keys:**
   - Get from: https://dashboard.paystack.com/#/settings/developers (switch to Live Mode)
   - Add to Render environment variables

2. **Update Webhook URL:**
   - Remove ngrok webhook
   - Add production webhook: `https://motoka-backend.onrender.com/api/webhooks/paystack`

3. **Update Frontend URLs:**
   - Ensure `FRONTEND_URL` points to `https://motokaapp.ng`
   - Update callback URLs

4. **Test with Small Amount:**
   - Use your own card for a ₦100 test transaction
   - Verify everything works end-to-end

5. **Monitor:**
   - Watch Paystack dashboard for transactions
   - Check Render logs for errors
   - Monitor Supabase database

---

## 🔐 Security Notes

- ✅ Never commit test or live keys to git
- ✅ Always use HTTPS for webhooks (ngrok does this automatically)
- ✅ Test keys can't charge real money
- ✅ Webhook signature is verified automatically
- ✅ Production uses same code, just different keys

---

## 📞 Need Help?

If you encounter issues:

1. Check ngrok dashboard: http://localhost:4040
2. Check backend logs in terminal
3. Check Supabase logs in dashboard
4. Check Paystack webhook logs: https://dashboard.paystack.com/#/settings/developers
5. Let me know the error and I'll help debug!

---

## Next Steps

1. Tell me when you've verified migrations (7 tables exist)
2. Give me your Paystack TEST keys
3. I'll update .env and help you test
4. We'll test locally with ngrok
5. Once working, deploy to production with live keys

Ready? 🚀
