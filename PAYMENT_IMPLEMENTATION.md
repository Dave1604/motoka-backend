# Payment System Implementation

## Setup

### Environment Variables

```env
PAYSTACK_SECRET_KEY=sk_test_...
PAYSTACK_PUBLIC_KEY=pk_test_...
PAYMENT_CALLBACK_URL=http://localhost:3001/payment/callback
PAYMENT_SUCCESS_URL=http://localhost:3001/payment/success
PAYMENT_CANCEL_URL=http://localhost:3001/payment/cancel
FRONTEND_URL=http://localhost:3001
```

## API Endpoints

### Payment Configuration

**GET** `/api/payments/config`
- Returns Paystack public key for frontend

### Renewal Items

**GET** `/api/payment-schedule`
- Returns available renewal items with prices

**GET** `/api/payment-schedule/get-payment-head`
- Returns payment head categories

### Location Data

**GET** `/api/get-all-state`
- Returns all Nigerian states with delivery fees

**GET** `/api/payments/states/:stateCode/lgas`
- Returns LGAs for a specific state

### Initialize Payment

**POST** `/api/payments/initialize`
```json
{
  "car_slug": "toyota-camry-abc123",
  "payment_schedule_id": ["vehicle_licence", "road_worthiness"],
  "renewal_months": 12,
  "delivery_details": {
    "address": "123 Main St",
    "state": "Lagos",
    "lga": "Ikeja",
    "contact": "+2341234567890"
  }
}
```

**Response:**
```json
{
  "status": true,
  "message": "Payment initialized successfully",
  "data": {
    "reference": "PAY-...",
    "authorization_url": "https://paystack.com/...",
    "access_code": "...",
    "amount": 1970000
  }
}
```

### Verify Payment

**GET** `/api/payments/verify/:reference`
- Verifies payment status with Paystack
- Returns transaction details and order info

**POST** `/api/payment/paystack/verify/:reference`
- Alternative verify endpoint

### Payment Status

**GET** `/api/payments/:reference/status`
- Lightweight status check (no Paystack API call)

**GET** `/api/payments/:reference`
- Full transaction details

### Payment Management

**PUT** `/api/payments/:reference/cancel`
- Cancel/abandon a pending payment

**POST** `/api/payments/:reference/retry`
- Retry a failed or abandoned payment

### Payment History

**GET** `/api/payments/history`
- User's payment history (paginated)

**GET** `/api/payments/car/:slug`
- Payments for a specific car

**GET** `/api/payment/car-receipt/:identifier`
- Payment receipt (car ID, slug, or order number)

### Orders

**GET** `/api/orders`
- User's renewal orders

**GET** `/api/orders/:orderNumber`
- Specific order details

### Subscriptions

**GET** `/api/subscriptions`
- User's subscriptions

**POST** `/api/subscriptions`
```json
{
  "car_slug": "toyota-camry-abc123",
  "amount": 1970000,
  "plan": "annual"
}
```

**PUT** `/api/subscriptions/:id/cancel`
- Cancel subscription

**PUT** `/api/subscriptions/:id/pause`
- Pause subscription

**PUT** `/api/subscriptions/:id/resume`
- Resume subscription

## Webhook

**POST** `/api/webhooks/paystack`
- Paystack webhook endpoint
- Automatically processes payment updates
- Requires signature verification

## Response Format

All endpoints return:
```json
{
  "status": true|false,
  "message": "Success message",
  "data": { ... }
}
```

## Error Handling

Errors return:
```json
{
  "status": false,
  "message": "Error message",
  "errors": { ... } // Optional
}
```

## Frontend Integration

1. Get renewal items: `GET /api/payment-schedule`
2. Get states: `GET /api/get-all-state`
3. Get LGAs: `GET /api/payments/states/:stateCode/lgas`
4. Initialize payment: `POST /api/payments/initialize`
5. Redirect user to `authorization_url`
6. After redirect, verify: `GET /api/payments/verify/:reference`
7. Display order confirmation

## Testing

Use Paystack test keys for development:
- Test card: `4084084084084081`
- CVV: Any 3 digits
- Expiry: Any future date
- PIN: Any 4 digits
