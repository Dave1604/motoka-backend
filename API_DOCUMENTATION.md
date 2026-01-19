# Motoka API Documentation

**Base URL**: `https://your-app.onrender.com/api`

---

## Authentication

All protected endpoints require the `Authorization` header:
```
Authorization: Bearer <access_token>
```

---

## Endpoints

### 1. Register User

```http
POST /api/register
Content-Type: application/json

{
  "first_name": "John",
  "last_name": "Doe",
  "email": "john@gmail.com",
  "phone": "+2341234567890",
  "password": "SecurePass123!",
  "password_confirmation": "SecurePass123!"
}
```

**Response (201):**
```json
{
  "success": true,
  "message": "Registration successful. Please check your email to verify your account.",
  "data": {
    "user": {
      "id": "uuid",
      "email": "john@gmail.com",
      "user_id": "cED2iP",
      "first_name": "John",
      "last_name": "Doe",
      "email_verified": false
    },
    "session": {
      "access_token": "eyJ...",
      "refresh_token": "...",
      "expires_in": 3600
    }
  }
}
```

---

### 2. Login (Password)

```http
POST /api/login
Content-Type: application/json

{
  "email": "john@gmail.com",
  "password": "SecurePass123!"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": { ... },
    "session": {
      "access_token": "eyJ...",
      "refresh_token": "...",
      "expires_in": 3600
    }
  }
}
```

**Response (200) - 2FA Required:**
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

### 3. Login (OTP - Passwordless)

**Step 1: Request OTP**
```http
POST /api/send-login-otp
Content-Type: application/json

{
  "email": "john@gmail.com"
}
```

**Response:**
```json
{
  "success": true,
  "message": "OTP sent to your email"
}
```

**Step 2: Verify OTP**
```http
POST /api/verify-login-otp
Content-Type: application/json

{
  "email": "john@gmail.com",
  "otp": "123456"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": { ... },
    "session": { ... }
  }
}
```

---

### 4. Forgot Password

**Step 1: Request OTP**
```http
POST /api/send-otp
Content-Type: application/json

{
  "email": "john@gmail.com"
}
```

**Step 2: Verify OTP**
```http
POST /api/verify-otp
Content-Type: application/json

{
  "email": "john@gmail.com",
  "otp": "123456"
}
```

**Response:**
```json
{
  "success": true,
  "message": "OTP verified. Use the reset token to set new password.",
  "data": {
    "reset_token": "abc123xyz..."
  }
}
```

**Step 3: Reset Password**
```http
POST /api/reset-password
Content-Type: application/json

{
  "email": "john@gmail.com",
  "token": "abc123xyz...",
  "password": "NewSecurePass123!",
  "password_confirmation": "NewSecurePass123!"
}
```

---

### 5. Get Current User (Protected)

```http
GET /api/me
Authorization: Bearer <access_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "john@gmail.com",
      "user_id": "cED2iP",
      "first_name": "John",
      "last_name": "Doe",
      "phone_number": "+2341234567890",
      "email_verified": true,
      "two_factor_enabled": false,
      "created_at": "2026-01-14T10:00:00Z"
    }
  }
}
```

---

### 6. Logout (Protected)

```http
POST /api/logout
Authorization: Bearer <access_token>
```

---

### 7. Refresh Token

```http
POST /api/refresh
Content-Type: application/json

{
  "refresh_token": "your_refresh_token"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "session": {
      "access_token": "new_access_token",
      "refresh_token": "new_refresh_token",
      "expires_in": 3600
    }
  }
}
```

---

### 8. Email Verification

**Step 1: Request Verification OTP (after registration)**
```http
POST /api/verify/email-resend
Content-Type: application/json

{
  "email": "john@gmail.com"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Verification email sent"
}
```

**Step 2: Verify Email with OTP**
```http
POST /api/verify-email
Content-Type: application/json

{
  "email": "john@gmail.com",
  "otp": "123456"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Email verified successfully",
  "data": {
    "user": {
      "id": "uuid",
      "email": "john@gmail.com",
      "email_verified": true,
      ...
    },
    "session": {
      "access_token": "eyJ...",
      "refresh_token": "...",
      "expires_in": 3600
    }
  }
}
```

---

## Two-Factor Authentication (2FA)

### Enable Google Authenticator

```http
POST /api/2fa/enable-google
Authorization: Bearer <access_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "secret": "JBSWY3DPEHPK3PXP",
    "qr_code": "data:image/png;base64,...",
    "message": "Scan the QR code with Google Authenticator"
  }
}
```

### Verify Google Authenticator Setup

```http
POST /api/2fa/verify-google
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "code": "123456"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "enabled": true,
    "method": "google",
    "recovery_codes": ["ABC12345", "DEF67890", ...]
  }
}
```

### Verify 2FA During Login

```http
POST /api/2fa/verify-login
Content-Type: application/json

{
  "user_id": "uuid",
  "temp_token": "abc123...",
  "code": "123456"
}
```

### Check 2FA Status

```http
GET /api/2fa/status
Authorization: Bearer <access_token>
```

### Disable 2FA

```http
POST /api/2fa/disable
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "password": "YourCurrentPassword"
}
```

---

## Profile Settings

### 9. Get Profile (Protected)

```http
GET /api/settings/profile
Authorization: Bearer <access_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "profile": {
      "id": "uuid",
      "user_id": "cED2iP",
      "email": "john@gmail.com",
      "first_name": "John",
      "last_name": "Doe",
      "phone_number": "+2341234567890",
      "image": null,
      "nin": null,
      "address": null,
      "gender": null,
      "user_type": "user",
      "two_factor_enabled": false,
      "two_factor_type": null,
      "created_at": "2026-01-14T10:00:00Z",
      "updated_at": "2026-01-14T10:00:00Z"
    }
  }
}
```

---

### 10. Update Profile (Protected)

```http
PUT /api/settings/profile
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "first_name": "John",
  "last_name": "Doe",
  "phone_number": "+2348012345678",
  "image": "https://example.com/avatar.jpg",
  "nin": "AB123456789",
  "address": "123 Main Street, Lagos",
  "gender": "male"
}
```

**Note:** All fields are optional. Only include fields you want to update.

**Response:**
```json
{
  "success": true,
  "message": "Profile updated successfully",
  "data": {
    "profile": { ... }
  }
}
```

---

## Admin Endpoints

> **Note:** Admin endpoints require an admin user token. Regular users will receive a 403 Forbidden error.

### 11. List Users (Admin)

```http
GET /api/admin/users?page=1&limit=20&search=john&status=active
Authorization: Bearer <admin_access_token>
```

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| page | number | No | Page number (default: 1) |
| limit | number | No | Items per page (default: 20) |
| search | string | No | Search by name or phone |
| status | string | No | Filter: `active` or `suspended` |

**Response:**
```json
{
  "success": true,
  "data": {
    "users": [
      {
        "id": "uuid",
        "user_id": "cED2iP",
        "email": "john@gmail.com",
        "first_name": "John",
        "last_name": "Doe",
        "phone_number": "+2341234567890",
        "image": null,
        "user_type": "user",
        "is_admin": false,
        "is_suspended": false,
        "two_factor_enabled": false,
        "created_at": "2026-01-14T10:00:00Z"
      }
    ],
    "pagination": {
      "total": 50,
      "page": 1,
      "limit": 20,
      "pages": 3
    }
  }
}
```

---

### 12. Get Single User (Admin)

```http
GET /api/admin/users/:userId
Authorization: Bearer <admin_access_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "user_id": "cED2iP",
      "email": "john@gmail.com",
      "email_verified": true,
      "first_name": "John",
      "last_name": "Doe",
      "phone_number": "+2341234567890",
      "image": null,
      "nin": "AB123456789",
      "address": "123 Main Street, Lagos",
      "gender": "male",
      "user_type": "user",
      "user_type_id": 2,
      "is_admin": false,
      "is_suspended": false,
      "two_factor_enabled": false,
      "two_factor_type": null,
      "kyc_status": "pending",
      "created_at": "2026-01-14T10:00:00Z",
      "updated_at": "2026-01-14T10:00:00Z"
    }
  }
}
```

---

### 13. Suspend User (Admin)

```http
PUT /api/admin/users/:userId/suspend
Authorization: Bearer <admin_access_token>
Content-Type: application/json

{
  "reason": "Violation of terms of service"
}
```

**Response:**
```json
{
  "success": true,
  "message": "User suspended successfully",
  "data": {
    "user_id": "uuid",
    "is_suspended": true
  }
}
```

---

### 14. Activate User (Admin)

```http
PUT /api/admin/users/:userId/activate
Authorization: Bearer <admin_access_token>
```

**Response:**
```json
{
  "success": true,
  "message": "User activated successfully",
  "data": {
    "user_id": "uuid",
    "is_suspended": false
  }
}
```

---

## Error Responses

All errors follow this format:

```json
{
  "success": false,
  "message": "Error description",
  "errors": [
    {
      "field": "email",
      "message": "Please enter a valid email"
    }
  ]
}
```

### Common HTTP Status Codes

| Code | Description |
|------|-------------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request |
| 401 | Unauthorized (invalid/expired token) |
| 403 | Forbidden (suspended account, unverified email) |
| 404 | Not Found |
| 409 | Conflict (email already exists) |
| 422 | Validation Error |
| 429 | Too Many Requests (rate limited) |
| 500 | Server Error |

---

## Rate Limits

| Endpoint Type | Limit |
|--------------|-------|
| General API | 100 requests / 15 min |
| Login/Register | 10 requests / 15 min |
| OTP requests | 5 requests / 15 min |
| Password reset | 3 requests / hour |

---

## Frontend Integration Example (React/Next.js)

```javascript
// api.js
const API_URL = 'https://your-app.onrender.com/api';

export async function login(email, password) {
  const res = await fetch(`${API_URL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  return res.json();
}

export async function getUser(accessToken) {
  const res = await fetch(`${API_URL}/me`, {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  return res.json();
}
```

---

## Support

For issues or questions, contact the backend team.
