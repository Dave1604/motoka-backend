# Admin Authentication Implementation - Fixed & Production Ready

## Overview

Fixed and refactored admin authentication to work properly with the frontend and follow codebase standards.

## What Was Fixed

### 1. **Critical Issues**
- ✅ Fixed inefficient user lookup (now uses `getUserByEmail` instead of listing all users)
- ✅ Added JWT_SECRET validation and requirement check
- ✅ Removed bad `crypto` package from dependencies (uses built-in Node.js crypto)
- ✅ Added rate limiting to admin auth endpoints
- ✅ Added input validation middleware
- ✅ Fixed suspended account check (now checks BEFORE sending OTP)
- ✅ Fixed Resend initialization (lazy-loaded to avoid env var timing issues)

### 2. **Code Quality**
- ✅ Renamed from `/api/newAdmin` to `/api/admin` to match frontend
- ✅ Changed from 6-digit to 4-digit OTP (matches frontend `maxLength="4"`)
- ✅ Fixed response format to match frontend expectations (`status` field)
- ✅ Added admin info to response payload
- ✅ Cleaned up unnecessary dotenv imports
- ✅ Added proper error messages throughout
- ✅ Fixed middleware application (per-route instead of global)

### 3. **Security Enhancements**
- ✅ Rate limiting: 5 requests/15min for OTP, 10 requests/15min for verification
- ✅ Input validation on all endpoints
- ✅ OTP hashing with SHA-256
- ✅ 5-minute OTP expiration
- ✅ JWT tokens with 30-minute expiry
- ✅ Suspended account checks
- ✅ Admin privilege verification

## Files Changed

### New Files Created
1. `src/controllers/adminAuth.controller.js` - Admin auth logic
2. `src/routes/adminAuth.routes.js` - Admin auth routes
3. `src/middleware/authenticateAdmin.js` - JWT token authentication middleware
4. `ADMIN_AUTH_IMPLEMENTATION.md` - This documentation

### Files Modified
1. `src/index.js` - Updated route imports and added JWT_SECRET requirement
2. `src/routes/admin.routes.js` - Changed from global middleware to per-route middleware
3. `src/services/email/email.service.js` - Fixed Resend lazy-loading, removed duplicate dotenv imports
4. `package.json` - Removed bad crypto dependency, kept jsonwebtoken
5. `.env` - Added JWT_SECRET

### Files Deleted
1. `src/controllers/newAdminController.js` - Replaced with adminAuth.controller.js
2. `src/routes/newAdminRoutes.js` - Replaced with adminAuth.routes.js

## API Endpoints

### 1. Send OTP to Admin Email

**Endpoint:** `POST /api/admin/send-otp`

**Request:**
```json
{
  "email": "admin@example.com"
}
```

**Response (Success):**
```json
{
  "status": true,
  "message": "OTP sent to admin email",
  "data": {
    "email": "admin@example.com"
  }
}
```

**Response (Not Admin):**
```json
{
  "status": false,
  "message": "Access denied: Admin privileges required"
}
```

**Response (Suspended):**
```json
{
  "status": false,
  "message": "Your account has been suspended"
}
```

### 2. Verify OTP and Get JWT Token

**Endpoint:** `POST /api/admin/verify-otp`

**Request:**
```json
{
  "email": "admin@example.com",
  "otp": "1234"
}
```

**Response (Success):**
```json
{
  "status": true,
  "message": "Admin login successful",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "admin": {
      "id": "uuid",
      "email": "admin@example.com",
      "first_name": "John",
      "last_name": "Doe",
      "is_admin": true
    }
  }
}
```

**Response (Invalid OTP):**
```json
{
  "status": false,
  "message": "Invalid OTP"
}
```

**Response (Expired OTP):**
```json
{
  "status": false,
  "message": "OTP has expired"
}
```

## Environment Variables

### Required
Add this to your `.env` file:

```env
# JWT Secret for Admin Authentication
# IMPORTANT: Generate a strong random secret in production (min 32 characters)
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production-min-32-chars
```

### Generate Secure JWT_SECRET
For production, generate a secure secret:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

## Testing Steps

### 1. Backend Testing

Start the server:
```bash
cd backend
npm start
```

Test send OTP (will fail without real admin email):
```bash
curl -X POST http://localhost:3000/api/admin/send-otp \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com"}'
```

### 2. Frontend Integration Testing

The frontend is already configured correctly:
- ✅ Calls `/api/admin/send-otp`
- ✅ Calls `/api/admin/verify-otp`
- ✅ Expects 4-digit OTP
- ✅ Expects `status` field in response
- ✅ Expects `token` and `admin` in data

### 3. Create Test Admin User

To test the complete flow, create an admin user in Supabase:

1. Go to Supabase Dashboard → Authentication → Users
2. Create a new user or select existing user
3. Go to Table Editor → `profiles` table
4. Find the user and set `is_admin = true`
5. Use that email to test the admin login flow

### 4. End-to-End Test

1. Start backend: `npm start`
2. Start frontend: `npm start` (in frontend directory)
3. Go to `/admin/login`
4. Enter admin email
5. Check email for 4-digit OTP
6. Enter OTP
7. Should redirect to `/admin/dashboard`

## Security Considerations

### Production Checklist

- [ ] Generate strong JWT_SECRET (64+ characters, use crypto.randomBytes)
- [ ] Set `NODE_ENV=production` in production
- [ ] Use HTTPS only (no HTTP)
- [ ] Configure CORS to specific frontend domain (not `origin: true`)
- [ ] Monitor failed login attempts
- [ ] Set up email alerting for admin logins
- [ ] Consider adding IP whitelisting for admin endpoints
- [ ] Enable database query logging for admin actions
- [ ] Set up 2FA for admin accounts (future enhancement)

## Frontend-Backend Contract

### Request Format
Both endpoints expect JSON with `Content-Type: application/json`

### Response Format
All responses follow this structure:
```json
{
  "status": boolean,
  "message": string,
  "data": object (optional)
}
```

### OTP Format
- **Length:** 4 digits
- **Format:** Numeric (1000-9999)
- **Expiry:** 5 minutes
- **Storage:** SHA-256 hashed

### JWT Token
- **Algorithm:** HS256
- **Expiry:** 30 minutes
- **Payload:**
  ```json
  {
    "id": "user-uuid",
    "email": "admin@example.com",
    "is_admin": true,
    "type": "admin"
  }
  ```

## Usage in Protected Routes

To protect admin routes with JWT authentication:

```javascript
import { authenticateAdmin } from '../middleware/authenticateAdmin.js';

// Apply to routes that need JWT-based admin auth
router.get('/admin-stats', authenticateAdmin, (req, res) => {
  // req.admin is available here
  const { id, email, is_admin } = req.admin;
  // ... your logic
});
```

## Troubleshooting

### Server won't start
- Check `.env` file exists with all required variables
- Verify `JWT_SECRET` is set
- Check `RESEND_API_KEY` is valid

### "Invalid OTP" error
- OTP expires after 5 minutes
- OTP is case-sensitive (numbers only)
- Each OTP can only be used once

### "Admin privileges required"
- User must have `is_admin = true` in profiles table
- Check Supabase profiles table directly

### Frontend shows "Network error"
- Verify backend is running on port 3000
- Check CORS configuration allows frontend origin
- Check browser console for actual error

## Next Steps

1. ✅ **Done:** Fixed all code issues
2. ✅ **Done:** Updated dependencies
3. ✅ **Done:** Added JWT_SECRET to .env
4. ⏭️ **TODO:** Generate production JWT_SECRET
5. ⏭️ **TODO:** Create test admin user in Supabase
6. ⏭️ **TODO:** Test with frontend
7. ⏭️ **TODO:** Update JWT_SECRET before deploying to production

## Branch Management

### Current Status
- ✅ You're on `Azeez` branch with the original implementation
- ✅ All fixes have been applied to your working directory
- ✅ Files are ready to commit

### Recommended Workflow

**Option 1: Create New Branch (Recommended)**
```bash
# Create a new branch for the fixed version
git checkout -b admin-auth-fixed

# Stage all changes
git add .

# Commit
git commit -m "Fix admin auth implementation

- Fixed inefficient user lookups
- Added rate limiting and validation
- Changed to 4-digit OTP to match frontend
- Fixed response format for frontend compatibility
- Added JWT_SECRET requirement
- Improved security and error handling
"

# Push to remote
git push origin admin-auth-fixed

# Create PR on GitHub
# Review and merge when ready
```

**Option 2: Use Current Branch**
```bash
# Stay on current branch
git add .
git commit -m "Fix admin auth implementation"
git push origin Azeez
```

### What NOT to Do
- ❌ Don't merge Azeez branch as-is (it has issues)
- ❌ Don't manually merge - you already have the fixes locally
- ✅ Just commit your current changes and push

## Support

If you encounter any issues:
1. Check server logs: Look for `[Admin Auth]` prefixed messages
2. Check `.env` file has all required variables
3. Verify admin user exists in Supabase with `is_admin = true`
4. Test endpoints with curl first before testing with frontend
