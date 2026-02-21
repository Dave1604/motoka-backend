# Quick Fix: Missing Migrations

## ✅ What I Found

You have **4 tables** but need **6 tables**:
- ✅ `payment_transactions` (exists)
- ✅ `renewal_orders` (exists)
- ✅ `renewal_items` (exists)
- ✅ `states` (exists)
- ❌ `subscriptions` (MISSING - migration 016)
- ❌ `local_governments` (MISSING - migration 023)

Also missing:
- ❌ Webhook columns on `payment_transactions` (migration 021)

---

## 🔧 Step 1: Run Missing Migrations

1. **Open Supabase Dashboard:**
   - Go to: https://supabase.com/dashboard/project/ucvnkouowpghnffvxrnb
   - Click "SQL Editor" in left sidebar
   - Click "New Query"

2. **Copy the entire file:**
   - Open: `/Users/mac/Documents/Motoka/backend/RUN_MISSING_MIGRATIONS.sql`
   - Copy ALL the SQL code

3. **Paste and Run:**
   - Paste into Supabase SQL Editor
   - Click "Run" (or Cmd+Enter)

4. **Verify Success:**
   - You should see "Success. No rows returned" or similar
   - Run this verification query:

```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN (
  'payment_transactions',
  'renewal_orders',
  'subscriptions',
  'renewal_items',
  'states',
  'local_governments'
)
ORDER BY table_name;
```

**Expected:** You should now see **6 tables** ✅

---

## 🔑 Step 2: Paystack Keys Added

✅ I've already added your Paystack TEST keys to `.env`:
- `PAYSTACK_SECRET_KEY=sk_test_e7624046e16e585d0a56416dc39e742b4f82fc10`
- `PAYSTACK_PUBLIC_KEY=pk_test_a154c1c2ce08c48be627be533d0b62ec73feb4d5`

---

## 🌐 Step 3: Set Up ngrok for Webhook Testing

### Install ngrok:

```bash
# Option 1: Homebrew (recommended)
brew install ngrok/ngrok/ngrok

# Option 2: Download from https://ngrok.com/download
```

### Sign Up (Free):
1. Go to: https://dashboard.ngrok.com/signup
2. Sign up for free account
3. Get your authtoken from: https://dashboard.ngrok.com/get-started/your-authtoken

### Configure ngrok:

```bash
ngrok config add-authtoken YOUR_AUTH_TOKEN_HERE
```

### Start Your Backend:

```bash
cd /Users/mac/Documents/Motoka/backend
npm start
```

### Start ngrok (in NEW terminal):

```bash
ngrok http 3000
```

You'll see output like:
```
Forwarding  https://abc123def456.ngrok-free.app -> http://localhost:3000
```

**Your webhook URL will be:**
```
https://abc123def456.ngrok-free.app/api/webhooks/paystack
```

---

## 🔗 Step 4: Configure Paystack Webhook

1. **Go to Paystack Dashboard:**
   - https://dashboard.paystack.com/#/settings/developers
   - Make sure you're in **Test Mode** (toggle at top right)

2. **Add Webhook:**
   - Scroll to "Webhooks" section
   - Click "Add Webhook"
   - **Webhook URL**: Paste your ngrok URL + `/api/webhooks/paystack`
     - Example: `https://abc123def456.ngrok-free.app/api/webhooks/paystack`
   - **Events**: Select:
     - ✅ `charge.success`
     - ✅ `charge.failed`
   - Click "Save"

**Important:** 
- ⚠️ Each time you restart ngrok, you get a new URL
- ⚠️ You'll need to update the webhook URL in Paystack each time
- ⚠️ Or use ngrok paid plan for static domain

---

## 🧪 Step 5: Test Payment Flow

### Start Services:

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

### Test Payment:

1. **Initialize payment** via your frontend or Postman
2. **Complete payment** with Paystack test card:
   - Card: `4084 0840 8408 4081`
   - CVV: `408`
   - Expiry: `12/30`
   - PIN: `0000`

3. **Monitor webhook:**
   - Open ngrok dashboard: http://localhost:4040
   - You'll see the webhook POST request from Paystack
   - Check backend logs for processing

4. **Verify:**
   - Check database: `SELECT * FROM payment_transactions ORDER BY created_at DESC LIMIT 1;`
   - Check orders: `SELECT * FROM renewal_orders ORDER BY created_at DESC LIMIT 1;`

---

## ✅ Checklist

- [ ] Run `RUN_MISSING_MIGRATIONS.sql` in Supabase
- [ ] Verify 6 tables exist (run verification query)
- [ ] Install ngrok
- [ ] Configure ngrok authtoken
- [ ] Start backend server
- [ ] Start ngrok tunnel
- [ ] Add webhook URL to Paystack
- [ ] Test payment flow
- [ ] Verify webhook received (check ngrok dashboard)
- [ ] Verify transaction in database
- [ ] Verify order created

---

## 🐛 Troubleshooting

**"Table already exists" errors:**
- ✅ Safe to ignore - means table was already created
- The SQL uses `CREATE TABLE IF NOT EXISTS` so it won't break

**"Policy already exists" errors:**
- ✅ Safe to ignore - the SQL drops and recreates policies

**Webhook not received:**
- Check ngrok is running: http://localhost:4040
- Check backend is running on port 3000
- Verify webhook URL in Paystack matches ngrok URL
- Check Paystack webhook logs: https://dashboard.paystack.com/#/settings/developers

**"Invalid signature" error:**
- Verify `PAYSTACK_SECRET_KEY` in `.env` matches Paystack dashboard
- Make sure you're using TEST keys in test mode

---

## 📞 Next Steps

Once migrations are complete and ngrok is set up:

1. **Tell me when migrations are done** (6 tables confirmed)
2. **Give me your ngrok URL** (I'll help configure webhook)
3. **We'll test a payment together**
4. **Once working locally, we'll deploy to Render with live keys**

Ready? 🚀
