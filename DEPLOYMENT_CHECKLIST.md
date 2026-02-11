# Production Deployment Checklist

## ✅ Security Changes Applied

### 1. Rate Limiting - ENABLED
- ✅ OTP endpoint: 5 requests per 15 minutes
- ✅ Verify OTP endpoint: 10 requests per 15 minutes
- ✅ Prevents brute force and spam attacks

### 2. JWT Secret - SECURED
- ✅ Generated cryptographically secure 128-character secret
- ✅ Replaced default weak secret in `.env`

### 3. Admin Authentication
- ✅ 6-digit numeric OTP (more secure than 4-digit)
- ✅ OTP expiry: 5 minutes
- ✅ JWT token expiry: 30 minutes
- ✅ SHA-256 hashed OTP storage

## 🔧 Environment Variables to Set

### Required for Production Deployment

Copy these to your production environment (Render, Vercel, etc.):

```env
# Server
PORT=3000
NODE_ENV=production

# Supabase (same as development)
SUPABASE_URL=https://ucvnkouowpghnffvxrnb.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVjdm5rb3Vvd3BnaG5mZnZ4cm5iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc2NjI4NzYsImV4cCI6MjA4MzIzODg3Nn0.AYDoUqwAKyceXYJeXycYTEwgHqDul6ynImrlUbtYnx8
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVjdm5rb3Vvd3BnaG5mZnZ4cm5iIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzY2Mjg3NiwiZXhwIjoyMDgzMjM4ODc2fQ.fnGUo0ZUroYD5NlmetTW7ZPebSYSgY89alAqEbFfQBw

# Frontend URL (update to production URL)
FRONTEND_URL=https://your-frontend-url.vercel.app

# 2FA
TOTP_ISSUER=Motoka

# JWT Secret - IMPORTANT: Use the generated secret from .env
JWT_SECRET=34825126875d786d51f0cd46348decf374b704c9d3c682a28d495501d8e3d3a607189abfbf22b7c7a5aa23f57f9a9f9142fe7d0b40464a8f365d98d2030e4e0a

# Email Service (Resend)
# ⚠️ IMPORTANT: Get PRODUCTION API key from Resend for live deployment
RESEND_API_KEY=re_your_production_key_here
EMAIL_FROM="Motoka <no-reply@motokaapp.ng>"

# Cron / Edge Function
CRON_SECRET_KEY=sR9lUuUz0botkVv1DS7qfzGCkSPo5U9wVJmW8dR/g8s=
```

## 📧 Resend Email Setup for Production

### Current Status: Test Mode
- Test API key only sends to `rasak@motokaapp.ng`
- Domain `motokaapp.ng` is verified ✅

### For Boss to Test (Production):

**Option 1: Get Production API Key (Recommended)**
1. Go to [resend.com/api-keys](https://resend.com/api-keys)
2. Create a **production** API key
3. Update environment variable:
   ```env
   RESEND_API_KEY=re_your_production_key_here
   ```
4. Now can send to ANY email on `@motokaapp.ng`

**Option 2: Use Test Email (Quick Fix)**
1. Make `rasak@motokaapp.ng` an admin in Supabase
2. Boss uses that email to test
3. Check email at rasak's inbox

## 👤 Setting Up Admin Users

### In Supabase Dashboard:

1. **Table Editor → `profiles`**
2. Find the user by email
3. Set these fields:
   - `is_admin` = `TRUE`
   - `user_type_id` = `1` (Super_admin)
4. Click **Save**

### Create New Admin User:

```sql
-- First, create auth user in Supabase Auth Dashboard
-- Then update their profile:
UPDATE profiles 
SET is_admin = true, user_type_id = 1 
WHERE email = 'boss@motokaapp.ng';
```

## 🚀 Deployment Steps

### Backend Deployment (Render/Railway/etc.)

1. **Push code to GitHub:**
   ```bash
   git add .
   git commit -m "Production-ready: Enable rate limiting, secure JWT, 6-digit OTP"
   git push origin main
   ```

2. **On Render/Railway:**
   - Connect GitHub repo
   - Set environment variables from above
   - Deploy

3. **Get backend URL:**
   - Example: `https://motoka-backend.onrender.com`

### Frontend Deployment

1. **Update frontend `.env.production`:**
   ```env
   VITE_API_BASE_URL=https://motoka-backend.onrender.com/api
   VITE_ENV=production
   ```

2. **Deploy to Vercel/Netlify:**
   ```bash
   # Build
   npm run build
   
   # Deploy (Vercel)
   vercel --prod
   ```

3. **Update CORS in backend:**
   - In `backend/src/index.js`, update CORS origin to your frontend URL:
   ```javascript
   app.use(cors({
     origin: 'https://your-frontend-url.vercel.app',  // Update this
     credentials: true,
     methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
     allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Cache-Control', 'cache-control']
   }));
   ```

## ✅ Testing Checklist for Boss

### 1. Admin Login Flow
- [ ] Go to `https://your-app.com/admin/login`
- [ ] Enter admin email
- [ ] Receive 6-digit OTP via email (within 1 minute)
- [ ] Enter OTP
- [ ] Successfully redirects to admin dashboard
- [ ] Can see admin data (users, orders, cars, etc.)

### 2. Admin Logout
- [ ] Click logout button
- [ ] Redirects to login page
- [ ] Cannot access dashboard without logging in again

### 3. Security Tests
- [ ] Try invalid OTP → Shows error
- [ ] Try expired OTP (wait 6 minutes) → Shows error
- [ ] Try too many OTP requests → Rate limited
- [ ] Try accessing dashboard without token → Redirects to login

### 4. Rate Limiting
- [ ] Send OTP 6 times in a row → Should see "Too many OTP requests" on 6th attempt
- [ ] Wait 15 minutes → Can request OTP again

## 🔒 Security Features Enabled

- ✅ Rate limiting on all admin auth endpoints
- ✅ Strong JWT secret (128-character cryptographically secure)
- ✅ OTP hashing (SHA-256)
- ✅ OTP expiration (5 minutes)
- ✅ JWT expiration (30 minutes)
- ✅ Input validation on all endpoints
- ✅ CORS protection
- ✅ Helmet security headers
- ✅ XSS protection
- ✅ CSRF protection

## 📊 Monitoring

### Things to Monitor After Deployment:

1. **Rate limit hits** - Check logs for rate limit errors
2. **Failed login attempts** - Monitor for brute force attacks
3. **Email delivery** - Check Resend dashboard for failed emails
4. **JWT token expirations** - Normal, happens every 30 minutes
5. **Admin activity** - Log all admin actions for audit trail

## 🐛 Troubleshooting

### Email Not Arriving
- Check Resend dashboard for delivery status
- Verify email is on verified domain (`@motokaapp.ng`)
- Check spam folder
- Ensure production API key is set (not test key)

### Rate Limit Issues
- Wait 15 minutes for limit to reset
- For development, temporarily disable in `adminAuth.routes.js`
- For production, limits are necessary for security

### JWT Token Expired
- Normal after 30 minutes
- User must log in again
- Consider longer expiry for production (1-2 hours)

### CORS Errors
- Update CORS origin in `backend/src/index.js` to match frontend URL
- Restart backend after changes

## 🎯 Next Steps After Deployment

1. **Get production Resend API key** - Enable sending to all admin emails
2. **Set up monitoring** - Use services like Sentry, LogRocket
3. **Enable HTTPS** - Ensure both frontend and backend use HTTPS
4. **Database backups** - Set up automated Supabase backups
5. **Admin audit log** - Track all admin actions
6. **2FA for super admin** - Add extra security for critical accounts

## 📝 Current Status Summary

### ✅ Ready for Production
- Rate limiting: **ENABLED**
- JWT secret: **SECURED**
- OTP: **6-digit numeric**
- Validation: **ENABLED**
- Error handling: **IMPROVED**
- Frontend: **UPDATED** (6-digit OTP)
- Logout: **FIXED**

### ⚠️ Needs Update for Production
- [ ] Get **production Resend API key** (currently test mode)
- [ ] Update **CORS** origin to production frontend URL
- [ ] Set **NODE_ENV=production** in deployment
- [ ] Update **FRONTEND_URL** to production URL

### 📧 Email Configuration
- Domain verified: ✅ `motokaapp.ng`
- Test key limitation: Can only send to `rasak@motokaapp.ng`
- Production key needed: To send to other admins

---

**You're ready to deploy!** Just get the production Resend API key and set environment variables on your hosting platform.
