# ENVIRONMENT VARIABLES GUIDE

## 🔑 Critical Environment Variables for Production

### 1. JWT_SECRET
**Current Value (from your .env):**
```
34825126875d786d51f0cd46348decf374b704c9d3c682a28d495501d8e3d3a607189abfbf22b7c7a5aa23f57f9a9f9142fe7d0b40464a8f365d98d2030e4e0a
```

**What it does:**
- Signs and verifies admin JWT tokens
- Like a master password for creating secure tokens
- Must be kept SECRET and NEVER shared publicly

**For Production (Render):**
1. Go to Render Dashboard → Your Backend Service → Environment
2. Add variable: `JWT_SECRET`
3. Paste the EXACT value above
4. Save and redeploy

**Security:** This is already a strong 128-character cryptographically secure secret. Perfect for production! ✅

---

### 2. RESEND_API_KEY
**Current Value (from your .env):**
```
re_CxkR3R1v_6zTaJzsT5v3va5bsZGv1eJZv
```

**What it does:**
- Sends emails (OTP codes, welcome emails, notifications)
- Powers the entire email system

**⚠️ IMPORTANT - Current Status:**
This is a **TEST API KEY**. Test keys have limitations:
- Can only send emails to verified addresses (like rasak@motokaapp.ng)
- Cannot send to other email addresses
- Good for development, NOT for production

**For Production (Render):**
1. Go to [resend.com/api-keys](https://resend.com/api-keys)
2. Create a new **Production API Key**
3. Copy the key (starts with `re_`)
4. In Render Dashboard → Environment Variables
5. Add/Update: `RESEND_API_KEY` with the new production key
6. Save and redeploy

**Why you need this:** So your boss (and other admins) can receive OTP emails at ANY email address, not just rasak@motokaapp.ng

---

### 3. FRONTEND_URL
**Current Value (from your .env):**
```
http://localhost:3001
```

**What it does:**
- Used for CORS (allows frontend to call backend)
- Used in email links and redirects
- OAuth callback URLs reference this

**For Production (Render):**
1. Get your production frontend URL (e.g., from Vercel/Netlify)
   - Example: `https://motoka.vercel.app`
   - Or: `https://www.motokaapp.ng`
2. In Render Dashboard → Environment Variables
3. Add/Update: `FRONTEND_URL` with your production URL
4. Save and redeploy

**Format:** Must include protocol (https://) and NO trailing slash
- ✅ Good: `https://motoka.vercel.app`
- ❌ Bad: `https://motoka.vercel.app/`
- ❌ Bad: `motoka.vercel.app` (missing https://)

---

## 📋 Complete Production Environment Variables Checklist

Copy all these to your Render Dashboard:

```bash
# Server (usually set automatically by Render)
PORT=3000
NODE_ENV=production

# Supabase (from your current .env)
SUPABASE_URL=https://ucvnkouowpghnffvxrnb.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVjdm5rb3Vvd3BnaG5mZnZ4cm5iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc2NjI4NzYsImV4cCI6MjA4MzIzODg3Nn0.AYDoUqwAKyceXYJeXycYTEwgHqDul6ynImrlUbtYnx8
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVjdm5rb3Vvd3BnaG5mZnZ4cm5iIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzY2Mjg3NiwiZXhwIjoyMDgzMjM4ODc2fQ.fnGUo0ZUroYD5NlmetTW7ZPebSYSgY89alAqEbFfQBw

# Frontend URL - CHANGE THIS TO YOUR PRODUCTION URL
FRONTEND_URL=https://your-production-frontend-url.com

# JWT Secret (from your current .env - DO NOT CHANGE)
JWT_SECRET=34825126875d786d51f0cd46348decf374b704c9d3c682a28d495501d8e3d3a607189abfbf22b7c7a5aa23f57f9a9f9142fe7d0b40464a8f365d98d2030e4e0a

# Email Service - GET PRODUCTION KEY FROM RESEND
RESEND_API_KEY=<your-production-resend-key>
EMAIL_FROM="Motoka <no-reply@motokaapp.ng>"

# 2FA
TOTP_ISSUER=Motoka

# Cron (if using expiry notifications)
CRON_SECRET_KEY=sR9lUuUz0botkVv1DS7qfzGCkSPo5U9wVJmW8dR/g8s=
```

---

## 🚨 BEFORE YOU DEPLOY - ACTION ITEMS

### ✅ Must Do:
1. **Get Production Resend API Key**
   - Go to resend.com → API Keys
   - Create new production key
   - Replace test key in Render

2. **Set Production Frontend URL**
   - Get URL from Vercel/Netlify
   - Update FRONTEND_URL in Render
   - Format: `https://your-domain.com` (no trailing slash)

3. **Copy JWT_SECRET**
   - Use exact value from your .env
   - DO NOT generate a new one

### ⚠️ Optional but Recommended:
- Set `NODE_ENV=production` in Render (might be automatic)
- Keep CRON_SECRET_KEY if using expiry notifications

---

## 🧪 HOW TO TEST AFTER DEPLOYMENT

### Test Admin Login:
```bash
# Replace YOUR_PRODUCTION_URL with your Render backend URL
curl -X POST https://YOUR_PRODUCTION_URL/api/admin/send-otp \
  -H "Content-Type: application/json" \
  -d '{"email":"rasak@motokaapp.ng"}'

# Should return: {"status":true,"message":"OTP sent to admin email",...}
```

### Test Health:
```bash
curl https://YOUR_PRODUCTION_URL/health

# Should return: {"success":true,"status":"healthy",...}
```

---

## ❓ FAQ

**Q: Can I use the same JWT_SECRET from local in production?**  
A: YES! In fact, you MUST use the same one, or existing tokens won't work.

**Q: Why do I need a production Resend key?**  
A: Test keys only send to verified addresses. Production keys work for ANY email.

**Q: What if I don't have a production frontend URL yet?**  
A: Use a temporary one like `https://localhost:3001` but update it before boss tests.

**Q: How do I know if my Resend key is test or production?**  
A: Test keys have sending restrictions. If OTP emails only work for rasak@, it's a test key.

---

*Last Updated: Feb 10, 2026*
