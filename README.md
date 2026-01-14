# Motoka Backend API

Node.js/Express authentication API using Supabase.

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

Run the SQL migrations in order in your Supabase SQL Editor:

1. `supabase/migrations/001_user_types.sql`
2. `supabase/migrations/002_profiles.sql`
3. `supabase/migrations/003_password_reset_tokens.sql`
4. `supabase/migrations/004_kycs.sql`
5. `supabase/migrations/005_notifications.sql`
6. `supabase/migrations/006_handle_new_user.sql`

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
│   └── migrations/              # SQL migrations
├── package.json
├── env.example
└── README.md
```

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

