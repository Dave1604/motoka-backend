# Motoka Backend - Project Breakdown & Work Queue

**Generated:** January 28, 2026  
**Branch:** main (1 commit behind origin/main)

---

## ⚠️ First: Pull Latest Changes

Your local branch is **1 commit behind** origin/main. Run in your terminal:

```bash
cd /Users/mac/Documents/Motoka/backend
git pull
```

---

## 📁 Project Structure

```
backend/
├── src/
│   ├── config/
│   │   └── supabase.js              # Supabase clients (singleton pattern)
│   ├── controllers/
│   │   ├── admin.controller.js      # Admin user management
│   │   ├── auth.controller.js       # Auth, OTP, password reset
│   │   ├── car.controller.js        # Car CRUD
│   │   ├── profile.controller.js   # Profile settings
│   │   └── twoFactor.controller.js # 2FA (Google + Email)
│   ├── middleware/
│   │   ├── authenticate.js          # JWT + profile cache (10min TTL)
│   │   ├── checkAdmin.js            # Admin role check
│   │   ├── checkEmailVerified.js    # Email verification gate
│   │   ├── fileUpload.js            # Disk-based multer (car docs)
│   │   └── rateLimiter.js           # In-memory rate limits
│   ├── routes/
│   │   ├── admin.routes.js          # /api/admin/*
│   │   ├── auth.routes.js           # /api/* (auth, 2FA)
│   │   ├── car.routes.js            # /api/reg-car, /api/get-cars, etc.
│   │   └── profile.routes.js        # /api/settings/profile
│   ├── services/
│   │   ├── car.service.js           # Car DB operations
│   │   ├── carDuplicateChecker.js   # Deprecated (constraint-based now)
│   │   ├── email/
│   │   │   └── email.service.js     # Resend integration
│   │   ├── fileUpload.service.js    # Supabase Storage uploads
│   │   └── twoFactor.service.js    # 2FA logic
│   ├── utils/                       # Validators, helpers, responses
│   ├── constants/                   # Car error codes, HTTP status
│   ├── __tests__/                   # Jest tests (car routes)
│   └── index.js                     # Express app entry
├── supabase/migrations/              # 12 SQL migrations
├── scripts/
│   └── testEmail.js                 # Email testing utility
├── docs/postman/                    # Postman collection
└── [config files]
```

---

## ✅ What's Complete & Working

### Authentication
| Feature | Status | Provider |
|---------|--------|----------|
| Register (email/password) | ✅ | Supabase Auth |
| Login (email/password) | ✅ | Supabase Auth |
| Login OTP (passwordless) | ✅ | Supabase Auth → Resend SMTP |
| Verify Login OTP | ✅ | Supabase Auth |
| Password Reset OTP | ✅ | Backend → Resend API |
| Verify Password Reset OTP | ✅ | Backend |
| Reset Password | ✅ | Supabase Auth |
| Email Verification (signup) | ✅ | Supabase Auth → Resend SMTP |
| Resend Verification | ✅ | Supabase Auth → Resend SMTP |
| Refresh Token | ✅ | Supabase Auth |
| Logout | ✅ | Supabase Auth |

### 2FA
| Feature | Status | Provider |
|---------|--------|----------|
| Google Authenticator | ✅ | speakeasy |
| Email 2FA | ✅ | Backend → Resend API |
| 2FA Verify Login | ✅ | Backend |
| Recovery Codes | ✅ | Backend |
| Disable 2FA | ✅ | Backend |

### Profile & Admin
| Feature | Status |
|---------|--------|
| GET /me | ✅ |
| GET /settings/profile | ✅ |
| PUT /settings/profile | ✅ |
| GET /admin/users | ✅ (paginated, scalable) |
| GET /admin/users/:id | ✅ |
| PUT /admin/users/:id/suspend | ✅ |
| PUT /admin/users/:id/activate | ✅ |

### Cars
| Feature | Status |
|---------|--------|
| POST /reg-car | ✅ (disk uploads, constraint-based duplicates) |
| GET /get-cars | ✅ (paginated, combined query) |
| GET /cars/:slug | ✅ |
| PUT /cars/:slug | ✅ |
| DELETE /cars/:slug | ✅ (soft delete) |

### Scalability Fixes
| Fix | Status |
|-----|--------|
| Profile caching (10min TTL) | ✅ |
| Disk-based file uploads | ✅ |
| Rate limiter abstraction | ✅ |
| Combined car list query | ✅ |
| Deprecated duplicate checker | ✅ |
| Email column in profiles | ✅ (migration 012) |

### Email
| Component | Status |
|-----------|--------|
| Resend SDK | ✅ |
| Password reset emails | ✅ |
| 2FA emails | ✅ |
| Supabase SMTP → Resend | ✅ (configured in dashboard) |
| Test script | ✅ |

---

## 🔧 What Needs Work

### 1. **Notifications** (Stub - Returns Empty Array)
- **Location:** `src/index.js` line 101
- **Current:** `GET /api/notifications` returns `{ notifications: [] }`
- **Needed:** Real notification logic (DB table exists: `005_notifications.sql`)
- **Priority:** Medium (user requested to remove/ignore earlier)

### 2. **CORS - Production Restriction**
- **Location:** `src/index.js` line 64
- **Current:** `origin: true` (allows all origins)
- **TODO:** Restrict to `FRONTEND_URL` in production
- **Priority:** High (security)

### 3. **Redis Migration** (Future Scalability)
- **Locations:**
  - `authenticate.js` - Profile cache
  - `rateLimiter.js` - Rate limit store
- **Current:** In-memory (single instance only)
- **Needed:** Redis for multi-instance deployment
- **Priority:** Low (until you scale horizontally)

### 4. **File Upload Cleanup**
- **Location:** `fileUpload.js` - `cleanupTempFiles()` exported
- **Question:** Are car controllers calling `cleanupTempFiles()` after Supabase upload?
- **Priority:** Medium (disk space on Render)

### 5. **Admin Cars Endpoints** (Mentioned in Conversation)
- **Expected:** `GET /admin/cars`, `GET /admin/cars/:id`
- **Current:** Not implemented
- **Priority:** Depends on product needs

### 6. **README & Docs**
- **README:** References old `env.example` (should be `.env.example`)
- **README:** Missing migrations 007-012
- **render.yaml:** Missing `RESEND_API_KEY`, `EMAIL_FROM`
- **Priority:** Low (documentation)

### 7. **Duplicate env.example**
- **Files:** `.env.example` and `env.example` both exist
- **Action:** Consolidate to `.env.example` only
- **Priority:** Low

---

## 📊 Migrations Status

| # | Migration | Purpose |
|---|-----------|---------|
| 001 | user_types | User type enum |
| 002 | profiles | User profiles table |
| 003 | password_reset_tokens | Password reset OTP storage |
| 004 | kycs | KYC records |
| 005 | notifications | Notifications table |
| 006 | handle_new_user | Profile trigger on signup |
| 007 | cars | Cars table |
| 008 | add_global_uniqueness_constraints | Car uniqueness |
| 009 | create_storage_bucket | File storage |
| 010 | optimize-cars-table | Performance |
| 011 | remove_date_issued_requirement | Schema change |
| 012 | add_email_to_profiles | Scalability (email column) |

**Action:** Ensure all 12 migrations are applied in Supabase.

---

## 🛣️ API Endpoints Summary

### Public (No Auth)
```
POST /api/register
POST /api/login
POST /api/send-otp              # Password reset
POST /api/verify-otp
POST /api/reset-password
POST /api/send-login-otp        # Login OTP
POST /api/verify-login-otp
POST /api/auth/send-otp         # Alias
POST /api/auth/verify-otp       # Alias
POST /api/verify/email-resend
POST /api/verify-email
POST /api/refresh
POST /api/2fa/verify-login
POST /api/2fa/verify-recovery
```

### Protected (Bearer Token)
```
GET  /api/me
POST /api/logout
GET  /api/2fa/status
POST /api/2fa/enable-google
POST /api/2fa/verify-google
POST /api/2fa/enable-email
POST /api/2fa/verify-email
POST /api/2fa/send-code
POST /api/2fa/disable
GET  /api/settings/profile
PUT  /api/settings/profile
POST /api/reg-car
GET  /api/get-cars
GET  /api/cars/:slug
PUT  /api/cars/:slug
DELETE /api/cars/:slug
GET  /api/notifications         # Stub - returns []
```

### Admin (Bearer + Admin Role)
```
GET  /api/admin/users
GET  /api/admin/users/:userId
PUT  /api/admin/users/:userId/suspend
PUT  /api/admin/users/:userId/activate
```

---

## 📋 Suggested Work Queue (Priority Order)

### High Priority
1. **CORS** - Restrict to FRONTEND_URL in production
2. **Pull latest** - Sync with origin/main

### Medium Priority
3. **Notifications** - Implement or remove stub
4. **File cleanup** - Verify temp files deleted after car upload
5. **README** - Update env example, migrations list

### Low Priority
6. **Redis** - Plan for multi-instance (when needed)
7. **Admin cars** - Add if product requires
8. **Consolidate env.example** - Remove duplicate

---

## 🧪 Testing Checklist

- [ ] Run `npm test` - Car routes
- [ ] Run `node scripts/testEmail.js your@email.com` - Email
- [ ] Test password reset flow (production)
- [ ] Test login OTP flow (production)
- [ ] Test car registration (with file upload)
- [ ] Test admin user list
- [ ] Verify migration 012 applied (profiles.email column)

---

## 📦 Dependencies

| Package | Purpose |
|---------|---------|
| @supabase/supabase-js | Auth, DB, Storage |
| express | Web framework |
| cors | CORS middleware |
| helmet | Security headers |
| express-rate-limit | Rate limiting |
| express-validator | Input validation |
| multer | File uploads |
| resend | Email delivery |
| speakeasy | TOTP (2FA) |
| qrcode | 2FA QR codes |
| dotenv | Env vars |

---

## 🔐 Environment Variables

**Required:**
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

**Email (Resend):**
- `RESEND_API_KEY`
- `EMAIL_FROM`

**Optional:**
- `PORT` (default 3000)
- `FRONTEND_URL` (for CORS)
- `NODE_ENV`
- `TOTP_ISSUER`
- `UPLOAD_TEMP_DIR` (default /tmp/motoka-uploads)

---

## 📈 Production Readiness

| Area | Status |
|------|--------|
| Auth | ✅ Production ready |
| Email | ✅ Production ready |
| Cars | ✅ Production ready |
| Admin | ✅ Production ready |
| Scalability | ✅ Optimized for 1K-100K users |
| Security | ⚠️ CORS needs restriction |
| Monitoring | ✅ Resend dashboard, Render logs |
| Tests | ⚠️ Car routes only |

---

**Next Step:** Run `git pull` and pick an item from the work queue! 🚀
