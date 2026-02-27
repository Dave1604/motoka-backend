# Motoka Backend API

Node.js/Express backend with Supabase authentication and automated vehicle expiry notifications.

## Features

- ✅ User authentication (email/password, magic links)
- ✅ Two-factor authentication (Google Authenticator, Email OTP)
- ✅ Profile & KYC management
- ✅ Vehicle registration & management
- ✅ **Automated expiry notifications** (30d, 14d, 7d, 3d, 2d, 1d, expiry day, +3d, +7d)
- ✅ File uploads to Supabase Storage
- ✅ Rate limiting & security headers

## Quick Start

### 1. Install Dependencies

```bash
cd backend
npm install
```

### 2. Configure Environment

```bash
cp env.example .env
```

Edit `.env` with your Supabase credentials:
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_ANON_KEY` - Public anon key
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key (keep secret!)

### 3. Set Up Database

```bash
npx supabase db push
```

This applies all migrations including the expiry notification system.

**For expiry notifications setup**, see [DEPLOYMENT.md](DEPLOYMENT.md)

### 4. Run the Server

```bash
# Development (with auto-reload)
npm run dev

# Production
npm start
```

Server runs at `http://localhost:3000`

---

## API Endpoints

### Public Routes

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/register` | Register new user |
| POST | `/api/login` | Login with email/password |
| POST | `/api/send-otp` | Send password reset email |
| POST | `/api/reset-password` | Reset password |
| POST | `/api/send-login-otp` | Send magic login link |
| POST | `/api/verify/email-resend` | Resend verification email |
| POST | `/api/2fa/verify-login` | Verify 2FA during login |
| POST | `/api/2fa/verify-recovery` | Use recovery code |
| POST | `/api/refresh` | Refresh access token |

### Protected Routes (Require `Authorization: Bearer {token}`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/me` | Get current user |
| POST | `/api/logout` | Logout |
| GET | `/api/2fa/status` | Check 2FA status |
| POST | `/api/2fa/enable-google` | Enable Google Authenticator |
| POST | `/api/2fa/verify-google` | Confirm Google Auth setup |
| POST | `/api/2fa/enable-email` | Enable email 2FA |
| POST | `/api/2fa/verify-email` | Verify email 2FA code |
| POST | `/api/2fa/send-code` | Send email 2FA code |
| POST | `/api/2fa/disable` | Disable 2FA |

---

## Request/Response Examples

### Register

```bash
POST /api/register
Content-Type: application/json

{
  "first_name": "John",
  "last_name": "Doe",
  "email": "john@example.com",
  "phone": "+2341234567890",
  "password": "SecurePass123!",
  "password_confirmation": "SecurePass123!"
}
```

### Login

```bash
POST /api/login
Content-Type: application/json

{
  "email": "john@example.com",
  "password": "SecurePass123!"
}
```

### Response (Success)

```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": {
      "id": "uuid",
      "email": "john@example.com",
      "first_name": "John",
      "last_name": "Doe",
      "user_id": "J89SPg"
    },
    "session": {
      "access_token": "eyJ...",
      "refresh_token": "...",
      "expires_in": 3600
    }
  }
}
```

### Response (2FA Required)

```json
{
  "success": true,
  "message": "2FA verification required",
  "data": {
    "requires_2fa": true,
    "two_factor_method": "google",
    "temp_token": "abc123...",
    "user_id": "uuid"
  }
}
```

---

## File Structure

```
backend/
├── src/
│   ├── config/
│   │   └── supabase.js          # Supabase client setup
│   ├── controllers/
│   │   ├── auth.controller.js   # Auth endpoints
│   │   └── twoFactor.controller.js
│   ├── middleware/
│   │   ├── authenticate.js      # JWT validation
│   │   ├── checkAdmin.js        # Admin check
│   │   ├── checkEmailVerified.js
│   │   └── rateLimiter.js       # Rate limiting
│   ├── routes/
│   │   └── auth.routes.js       # Route definitions
│   ├── services/
│   │   └── twoFactor.service.js # 2FA logic
│   ├── utils/
│   │   ├── idGenerator.js       # ID/OTP generation
│   │   ├── responses.js         # Response helpers
│   │   └── validators.js        # Input validation
│   └── index.js                 # Server entry point
├── supabase/
│   ├── functions/
│   │   └── expiry-notifications/ # Edge Function for email notifications
│   └── migrations/              # SQL migrations (001-014)
├── package.json
├── env.example
├── README.md
├── DEPLOYMENT.md                # Expiry notification setup guide
└── QUICKSTART.md                # Quick reference commands
```

---

## Documentation

- **[DEPLOYMENT.md](DEPLOYMENT.md)** - Complete guide for setting up expiry notifications
- **[QUICKSTART.md](QUICKSTART.md)** - Quick reference commands
- **[API_DOCUMENTATION.md](API_DOCUMENTATION.md)** - REST API reference
- **[carApi.md](carApi.md)** - Vehicle management API

---

## Supabase Configuration

### Email Templates

Configure these in Supabase Dashboard → Authentication → Email Templates:

1. **Confirm signup** - Email verification
2. **Reset password** - Password reset link
3. **Magic link** - Passwordless login

### Auth Settings

In Supabase Dashboard → Authentication → Settings:

- Enable "Confirm email" for registration
- Set Site URL to your frontend URL
- Add Redirect URLs for OAuth callbacks

