# Email Service Migration: Brevo → Resend

## Overview

This migration replaces backend-generated email sending from Brevo to Resend. Supabase Auth emails (login OTP, signup verification) remain unchanged and continue using the SMTP provider configured in Supabase dashboard.

## What Changed

### ✅ **Migrated to Resend:**
- **Password Reset OTP** - Now actually sent via email (previously only logged)
- **2FA Email Codes** - Now actually sent via email (previously only logged)

### ✅ **Unchanged (Still use Supabase Auth SMTP):**
- **Login OTP** - Sent by Supabase via `signInWithOtp()`
- **Signup Verification** - Sent by Supabase via `signInWithOtp()`
- **Email Verification Resend** - Sent by Supabase via `signInWithOtp()`

## Required Environment Variables

Add these to your `.env` file:

```bash
# Resend API Configuration
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
EMAIL_FROM="Motoka <no-reply@motokaapp.ng>"
```

### Where to get these values:

1. **RESEND_API_KEY**
   - Log in to [Resend Dashboard](https://resend.com/api-keys)
   - Create a new API key
   - Copy the key (starts with `re_`)

2. **EMAIL_FROM**
   - Format: `"Display Name <email@yourdomain.com>"`
   - Must use a verified domain in Resend
   - Examples:
     - `"Motoka <no-reply@motokaapp.ng>"`
     - `"Motoka Support <support@motokaapp.ng>"`

## Local Testing

### 1. Install Dependencies

```bash
npm install
```

Verify `resend` package is installed:

```bash
npm list resend
```

### 2. Configure Environment Variables

Create or update `.env` file:

```bash
RESEND_API_KEY=re_your_actual_key_here
EMAIL_FROM="Motoka <no-reply@motokaapp.ng>"

# Other existing variables...
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_KEY=...
```

### 3. Test Email Sending

Run the test script:

```bash
node scripts/testEmail.js your-email@example.com
```

Expected output:

```
🧪 Testing Resend Email Service

📧 Recipient: your-email@example.com
📤 From: Motoka <no-reply@motokaapp.ng>

1️⃣  Testing simple email send...
   ✅ Simple email sent successfully

2️⃣  Testing password reset OTP email...
   ✅ Password reset email sent successfully

3️⃣  Testing 2FA code email...
   ✅ 2FA code email sent successfully

═══════════════════════════════════════
📊 Test Results:
   ✅ Passed: 3/3
   ❌ Failed: 0/3
═══════════════════════════════════════

🎉 All tests passed! Your email service is ready.
```

### 4. Test Backend Endpoints

Start the server:

```bash
npm run dev
```

Test password reset flow:

```bash
curl -X POST http://localhost:3000/api/send-otp \
  -H "Content-Type: application/json" \
  -d '{"email":"your-email@example.com"}'
```

Check your email inbox for the OTP code.

## Deployment Checklist

### Pre-deployment

- [ ] Domain verified in Resend
- [ ] RESEND_API_KEY created and copied
- [ ] EMAIL_FROM format correct
- [ ] Test script passes locally
- [ ] Password reset tested locally
- [ ] 2FA email tested locally

### Deployment Steps

#### For Render.com:

1. Go to your service dashboard
2. Navigate to **Environment** tab
3. Add/update environment variables:
   ```
   RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxx
   EMAIL_FROM="Motoka <no-reply@motokaapp.ng>"
   ```
4. Click **Save Changes**
5. Service will auto-deploy

#### For Other Platforms:

Set environment variables according to your platform's documentation:
- Heroku: `heroku config:set RESEND_API_KEY=re_xxx EMAIL_FROM="..."`
- Vercel: Add in Project Settings → Environment Variables
- Railway: Add in Variables tab
- AWS/Docker: Add to environment configuration

### Post-deployment

- [ ] Verify server starts without errors
- [ ] Test password reset on production
- [ ] Test 2FA email on production
- [ ] Monitor logs for email send confirmations
- [ ] Check Resend dashboard for sent emails

## Monitoring

### Success Indicators

Server logs will show:

```
[Email Service] Email sent successfully: { to: 'user@example.com', subject: 'Reset Your Motoka Password', id: 'abc123...' }
```

### Error Indicators

Server logs will show:

```
[Email Service] Send failed: { to: 'user@example.com', subject: '...', error: '...' }
```

Or:

```
[Password Reset] Email send failed: <error message>
[2FA] Email send failed for user: <userId> <error message>
```

### Resend Dashboard

Monitor email delivery in real-time:
- Log in to [Resend Dashboard](https://resend.com/emails)
- View sent emails, delivery status, and bounces
- Check API usage and limits

## Security Notes

### ✅ Security Improvements

1. **No OTP Logging**: OTP values are no longer logged to console
2. **Generic Responses**: Password reset doesn't reveal if email exists
3. **Error Handling**: Email failures don't expose internal errors to users

### ⚠️ Important Reminders

- **Never log OTP or 2FA codes** in production
- **Monitor bounce rates** in Resend dashboard
- **Keep API keys secure** - never commit to version control
- **Rotate API keys** periodically for security

## Troubleshooting

### Issue: "RESEND_API_KEY not configured"

**Solution:**
- Verify `.env` file contains `RESEND_API_KEY`
- Verify environment variable is set in deployment platform
- Restart server after adding environment variable

### Issue: "Email send failed: API key invalid"

**Solution:**
- Verify API key starts with `re_`
- Ensure you copied the full key from Resend
- Check if API key was deleted or expired in Resend dashboard

### Issue: "Email send failed: Domain not verified"

**Solution:**
- Verify your domain in Resend dashboard
- Use `onboarding@resend.dev` for testing only
- Add DNS records for your domain
- Wait for DNS propagation (up to 48 hours)

### Issue: Emails not received

**Check:**
1. Spam/junk folder
2. Email address spelling
3. Resend dashboard for delivery status
4. Server logs for send confirmation
5. Domain verification status

### Issue: Rate limit exceeded

**Solution:**
- Resend free tier: 100 emails/day
- Check your plan limits in Resend dashboard
- Upgrade plan if needed
- Implement request rate limiting on endpoints

## Rollback Plan

If issues arise, you can revert by:

1. **Option A: Use Supabase for all OTPs**
   - Modify password reset to use `supabase.auth.resetPasswordForEmail()`
   - Modify 2FA to use Supabase Auth instead of custom logic

2. **Option B: Revert to logging**
   - Comment out email sending calls
   - Uncomment console.log statements (temporary only!)

3. **Option C: Switch to different provider**
   - Replace Resend SDK with another provider
   - Update `src/services/email/email.service.js`

## Support

- **Resend Documentation**: https://resend.com/docs
- **Resend Status**: https://status.resend.com
- **Resend Support**: support@resend.com

## Changes Summary

| File | Changes |
|------|---------|
| `src/services/email/email.service.js` | ✨ Created - Centralized email service |
| `src/controllers/auth.controller.js` | 🔧 Modified - Send password reset emails |
| `src/services/twoFactor.service.js` | 🔧 Modified - Send 2FA emails |
| `scripts/testEmail.js` | ✨ Created - Email testing script |
| `package.json` | ➕ Added `resend` dependency |

## Migration Date

**Completed:** [Date]  
**Deployed to Production:** [Date]  
**Verified By:** [Name]

---

✅ **Migration Complete**
