# Test Payment Flow - Step by Step

## ✅ Setup Status

- ✅ Migrations complete (6 tables)
- ✅ Paystack TEST keys in `.env`
- ✅ ngrok running: `https://richard-nonmeditative-physiognomically.ngrok-free.dev`
- ✅ Backend running on `localhost:3000`
- ✅ Paystack webhook configured

**You're ready to test!** 🚀

---

## 📝 Prerequisites

Before testing, you need:

1. **User Account**
   - A registered user on your frontend
   - User must be logged in

2. **Car Registered**
   - At least one car registered to the user
   - Get the `car_slug` (e.g., `toyota-camry-abc123`)

3. **Monitor Windows Open**
   - ngrok dashboard: http://127.0.0.1:4040
   - Backend terminal (to see logs)

---

## 🧪 Option 1: Test via Frontend (Easiest)

### Step 1: Start Frontend

```bash
cd /Users/mac/Documents/Motoka-frontend
npm run dev
```

### Step 2: Navigate to Payment

1. Go to: http://localhost:3001
2. Login with your user
3. Select a car
4. Click "Renew Documents" or similar button
5. Select renewal items (Vehicle Licence, etc.)
6. Fill in delivery details
7. Click "Pay Now" or "Initialize Payment"

### Step 3: Complete Payment on Paystack

You'll be redirected to Paystack payment page:

**Use Paystack Test Card:**
- **Card Number**: `4084 0840 8408 4081`
- **CVV**: `408`
- **Expiry**: `12/30` (any future date)
- **PIN**: `0000`
- **OTP**: `123456` (if asked)

### Step 4: Monitor

**In ngrok dashboard (http://127.0.0.1:4040):**
- You'll see the webhook POST request from Paystack
- Event: `charge.success`

**In backend terminal:**
```
[Webhook] Received event: charge.success Event ID: evt_xxx
[Webhook] Processing charge.success: PAY-xxx
Transaction updated successfully
Order created: ORD-xxx
```

### Step 5: Verify Success

After payment:
- Frontend should show success page
- Check your email for payment confirmation
- Check database: order should be created

---

## 🧪 Option 2: Test via Postman/curl (Advanced)

### Step 1: Get User Token

Login via frontend or API to get JWT token.

### Step 2: Get Car Slug

```bash
# Replace YOUR_JWT_TOKEN with actual token
curl -X GET http://localhost:3000/api/cars \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

Copy a `car_slug` from the response.

### Step 3: Initialize Payment

```bash
curl -X POST http://localhost:3000/api/payments/initialize \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "car_slug": "YOUR_CAR_SLUG_HERE",
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

**Expected Response:**
```json
{
  "status": true,
  "message": "Payment initialized successfully",
  "data": {
    "reference": "PAY-1234567890",
    "authorization_url": "https://checkout.paystack.com/abc123",
    "access_code": "abc123xyz",
    "amount": 470000
  }
}
```

### Step 4: Complete Payment

1. Copy the `authorization_url` from response
2. Open in browser
3. Use test card details (see Option 1, Step 3)
4. Complete payment

### Step 5: Verify Payment

```bash
curl -X GET http://localhost:3000/api/payments/verify/PAY-1234567890 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Expected Response:**
```json
{
  "status": true,
  "message": "Payment verified successfully",
  "data": {
    "transaction": {
      "id": 1,
      "reference": "PAY-1234567890",
      "status": "successful",
      "amount": 470000,
      ...
    },
    "order": {
      "id": 1,
      "order_number": "ORD-1234567890",
      "status": "pending",
      ...
    }
  }
}
```

---

## 🔍 What to Watch For

### 1. ngrok Dashboard (http://127.0.0.1:4040)

You'll see:
```
POST /api/webhooks/paystack
Status: 200 OK
Request Headers:
  x-paystack-signature: ...
Request Body:
  {
    "event": "charge.success",
    "data": { ... }
  }
```

### 2. Backend Terminal

You'll see:
```
[Webhook] Received event: charge.success Event ID: evt_xxx
[Webhook] Processing charge.success: PAY-xxx
Processing payment success for reference: PAY-xxx
Transaction found: { id: 1, ... }
Transaction updated to successful
Creating order...
Order created: ORD-xxx
Sending payment success email to: user@example.com
[Webhook] Charge success processed successfully
```

### 3. Database

Check in Supabase SQL Editor:

```sql
-- Check transaction
SELECT * FROM payment_transactions ORDER BY created_at DESC LIMIT 1;

-- Check order
SELECT * FROM renewal_orders ORDER BY created_at DESC LIMIT 1;

-- Check if webhook event ID was recorded
SELECT webhook_event_id, webhook_processed_at 
FROM payment_transactions 
WHERE webhook_event_id IS NOT NULL
ORDER BY created_at DESC LIMIT 1;
```

---

## 🐛 Common Issues

### Issue: "Car not found"
**Solution:** Make sure you're using a valid `car_slug` for the logged-in user.

### Issue: "At least one renewal item must be selected"
**Solution:** Include `"vehicle_licence"` in `payment_schedule_id` (it's required).

### Issue: Webhook not received
**Checklist:**
- [ ] ngrok is running
- [ ] Backend is running
- [ ] Webhook URL in Paystack matches ngrok URL
- [ ] ngrok URL includes `https://` and ends with `/api/webhooks/paystack`
- [ ] Test Mode is ON in Paystack

### Issue: "Invalid signature"
**Solution:** Verify `PAYSTACK_SECRET_KEY` in `.env` matches Paystack test key.

### Issue: Order not created
**Possible causes:**
- Webhook not received (check ngrok dashboard)
- Backend error (check terminal logs)
- Transaction already processed (check `webhook_event_id`)

---

## 📊 Test Scenarios

Test these scenarios:

### ✅ Successful Payment
1. Initialize payment
2. Complete with valid test card
3. Verify webhook received
4. Verify transaction status = "successful"
5. Verify order created
6. Verify email sent

### ✅ Failed Payment
1. Initialize payment
2. Use test card `4084 0840 8408 4081` with WRONG PIN (not `0000`)
3. Payment should fail
4. Verify webhook `charge.failed` received
5. Verify transaction status = "failed"
6. Verify no order created

### ✅ Multiple Items
1. Initialize with multiple items:
   ```json
   "payment_schedule_id": ["vehicle_licence", "road_worthiness", "insurance"]
   ```
2. Verify total amount = ₦4,700 + ₦15,000 + ₦15,000 = ₦34,700 (3,470,000 kobo)
3. Complete payment
4. Verify order contains all selected items

### ✅ Idempotency (Duplicate Webhook)
1. Complete a payment
2. In ngrok dashboard, find the webhook request
3. Click "Replay" to send it again
4. Backend should ignore duplicate (same `webhook_event_id`)
5. Check logs: "Webhook event already processed"

---

## 📸 Screenshots to Take

Capture these for documentation:

1. **ngrok dashboard** showing webhook request
2. **Backend logs** showing successful processing
3. **Paystack dashboard** showing test transaction
4. **Frontend success page**
5. **Database** showing transaction and order

---

## 🎯 Success Criteria

You'll know it's working when:

- ✅ Payment completes on Paystack
- ✅ Webhook appears in ngrok dashboard (http://127.0.0.1:4040)
- ✅ Backend logs show successful processing
- ✅ Transaction status = "successful" in database
- ✅ Order created in database
- ✅ Email sent to user (check Resend dashboard)
- ✅ Frontend shows success message

---

## 🚀 Next Steps After Testing

Once local testing works:

1. **Deploy to Render** with test keys first
2. **Update webhook URL** in Paystack to Render URL:
   ```
   https://motoka-backend.onrender.com/api/webhooks/paystack
   ```
3. **Test on live environment** with test keys
4. **Switch to live keys** when ready for production
5. **Monitor** Paystack dashboard for real transactions

---

## 🆘 Need Help?

If something doesn't work:

1. Check ngrok dashboard: http://127.0.0.1:4040
2. Check backend terminal for errors
3. Check Paystack webhook logs: https://dashboard.paystack.com/#/settings/developers
4. Check Supabase logs in dashboard
5. Share the error with me and I'll help debug!

---

## 📝 Quick Test Checklist

- [ ] Backend running (`npm start`)
- [ ] ngrok running (`ngrok http 3000`)
- [ ] Frontend running (`npm run dev`)
- [ ] ngrok dashboard open (http://127.0.0.1:4040)
- [ ] Logged in to frontend
- [ ] Have a car registered
- [ ] Paystack webhook configured
- [ ] Test card ready: `4084 0840 8408 4081`

**Ready? Start testing!** 🎉
