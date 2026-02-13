# PRODUCTION ENVIRONMENT VARIABLES FOR RENDER
# Copy these to Render Dashboard > Your Service > Environment

## CRITICAL: Set these in Render now!

```bash
# Server
PORT=3000
NODE_ENV=production

# Supabase (SAME AS LOCAL)
SUPABASE_URL=https://ucvnkouowpghnffvxrnb.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVjdm5rb3Vvd3BnaG5mZnZ4cm5iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc2NjI4NzYsImV4cCI6MjA4MzIzODg3Nn0.AYDoUqwAKyceXYJeXycYTEwgHqDul6ynImrlUbtYnx8
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVjdm5rb3Vvd3BnaG5mZnZ4cm5iIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzY2Mjg3NiwiZXhwIjoyMDgzMjM4ODc2fQ.fnGUo0ZUroYD5NlmetTW7ZPebSYSgY89alAqEbFfQBw

# Frontend URL (CHANGE THIS!)
FRONTEND_URL=https://your-frontend-domain.vercel.app

# 2FA
TOTP_ISSUER=Motoka

# JWT Secret (SAME AS LOCAL)
JWT_SECRET=34825126875d786d51f0cd46348decf374b704c9d3c682a28d495501d8e3d3a607189abfbf22b7c7a5aa23f57f9a9f9142fe7d0b40464a8f365d98d2030e4e0a

# Email
RESEND_API_KEY=re_CxkR3R1v_6zTaJzsT5v3va5bsZGv1eJZv
EMAIL_FROM="Motoka <no-reply@motokaapp.ng>"

# Cron
CRON_SECRET_KEY=sR9lUuUz0botkVv1DS7qfzGCkSPo5U9wVJmW8dR/g8s=

# PAYSTACK LIVE KEYS (NOT TEST!)
PAYSTACK_SECRET_KEY=sk_live_YOUR_LIVE_SECRET_KEY
PAYSTACK_PUBLIC_KEY=pk_live_YOUR_LIVE_PUBLIC_KEY

# Payment URLs (PRODUCTION FRONTEND)
PAYMENT_CALLBACK_URL=https://your-frontend-domain.vercel.app/payment/paystack/callback
PAYMENT_SUCCESS_URL=https://your-frontend-domain.vercel.app/dashboard
PAYMENT_CANCEL_URL=https://your-frontend-domain.vercel.app/licenses/renew
```

## Quick Fix Steps:

1. Go to Render Dashboard
2. Click your backend service
3. Go to "Environment" tab
4. Add/update ALL these variables
5. Click "Save Changes"
6. Render will auto-redeploy

## Most Likely Missing:
- `PAYSTACK_SECRET_KEY` (live, not test)
- `PAYSTACK_PUBLIC_KEY` (live, not test)
- `PAYMENT_CALLBACK_URL` (production URL)
- `PAYMENT_SUCCESS_URL` (production URL)
- `PAYMENT_CANCEL_URL` (production URL)
