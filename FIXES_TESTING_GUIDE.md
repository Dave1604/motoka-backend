# Testing Guide for Recent Fixes

## Issues Fixed

### 1. ✅ Garage Page Not Loading
**Problem**: Garage page was crashing due to incorrect data access `Object.values(cars.cars)`
**Fix**: Changed to `cars?.cars` with optional chaining
**File**: `Motoka-frontend/src/features/garage/Garage.jsx`

### 2. ✅ Transaction History Empty
**Problem**: Transaction history wasn't showing purchased items because backend was querying wrong table
**Fix**: Updated `getUserTransactions` to fetch items from `renewal_orders.selected_items` JSONB field and lookup item details from `renewal_items` table
**File**: `backend/src/services/payment/transaction.service.js`

### 3. ✅ Car Status Not Updating to "Renewal in Progress"
**Problem**: Car was showing "21 days to expire" instead of "Renewal in progress" after payment
**Status**: Already working correctly in backend - `buildExpiryStatus` checks for pending orders
**Files**: 
- `backend/src/controllers/car.controller.js` - calls `getPendingOrdersForCars()`
- `backend/src/utils/expiryStatus.js` - returns `renewal_pending` status when order exists

### 4. ✅ Transaction History Breadcrumb
**Status**: Already showing correctly as "Settings / Transaction History"
**File**: `Motoka-frontend/src/features/settings/components/settings-layout.jsx`

---

## Testing Steps

### Test 1: Garage Page Loading
1. Navigate to `/garage`
2. ✅ Page should load without errors
3. ✅ All cars should be displayed correctly
4. ✅ No console errors

### Test 2: Transaction History
1. Login as user `rasak@motoka.ng`
2. Navigate to Settings → Payment & Billing → Transaction History
3. ✅ Should see list of transactions
4. ✅ Each transaction should show:
   - Order number or reference
   - Status (with colored badge)
   - Date
   - Amount in Naira (₦)
   - **List of items purchased** (e.g., "Vehicle Licence", "Insurance")

### Test 3: Car Status - "Renewal in Progress"
1. Login as user with pending payment
2. View dashboard or garage
3. ✅ Cars with pending orders should show:
   - Blue background (#E3F2FD)
   - Blue dot (#2196F3)
   - Text: "Renewal in progress"
4. ✅ Cars without pending orders should show normal status (e.g., "21 days to expire")

### Test 4: Transaction History Breadcrumb
1. Navigate to Settings → Transaction History
2. ✅ Breadcrumb should show "Settings / Transaction History"
3. ✅ URL should be clean (not showing full path)

---

## Debug Query for User rasak@motoka.ng

Run this in Supabase SQL Editor to check the user's data:

```sql
-- 1. Find user
SELECT id, user_id, email, first_name, last_name 
FROM profiles 
WHERE email = 'rasak@motoka.ng';

-- 2. Get transactions
SELECT 
    id, reference, status,
    ROUND(amount/100.0, 2) as amount_naira,
    created_at
FROM payment_transactions
WHERE user_id = (SELECT id FROM profiles WHERE email = 'rasak@motoka.ng')
ORDER BY created_at DESC;

-- 3. Get orders with selected items
SELECT 
    o.id, o.order_number, o.status,
    o.selected_items,
    ROUND(o.amount_paid/100.0, 2) as amount_naira,
    o.transaction_id
FROM renewal_orders o
WHERE o.user_id = (SELECT id FROM profiles WHERE email = 'rasak@motoka.ng')
ORDER BY o.created_at DESC;

-- 4. Check cars and pending orders
SELECT 
    c.id, c.slug, c.registration_no, c.expiry_date,
    ro.order_number, ro.status as order_status
FROM cars c
LEFT JOIN renewal_orders ro ON ro.car_id = c.id AND ro.status IN ('pending', 'processing')
WHERE c.user_id = (SELECT id FROM profiles WHERE email = 'rasak@motoka.ng')
ORDER BY c.created_at DESC;
```

---

## Backend API Endpoints to Test

### Get Transaction History
```bash
# With auth token
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:3000/api/payments/history
```

**Expected Response:**
```json
{
  "status": "success",
  "data": {
    "transactions": [
      {
        "id": "...",
        "reference": "...",
        "status": "successful",
        "amount": 2570000,
        "order": {
          "order_number": "ORD-...",
          "status": "pending"
        },
        "items": [
          {
            "name": "Vehicle Licence",
            "price": 470000,
            "quantity": 1
          }
        ]
      }
    ]
  }
}
```

### Get Cars with Status
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:3000/api/get-cars
```

**Expected Response:**
```json
{
  "status": "success",
  "data": {
    "cars": [
      {
        "id": 123,
        "registration_no": "ABC123",
        "expiry_date": "2026-03-08",
        "expiry_status": {
          "message": "Renewal in progress",
          "status": "renewal_pending",
          "has_pending_order": true,
          "order_number": "ORD-..."
        }
      }
    ]
  }
}
```

---

## Common Issues & Solutions

### Issue: Transaction history still empty
**Check:**
- Backend server restarted? `lsof -i:3000`
- Frontend refreshed? Cmd+Shift+R
- API returning items array? Check network tab

### Issue: Car status not showing "Renewal in progress"
**Check:**
- Does car have pending order? Run debug query
- Order status is 'pending' or 'processing'?
- Frontend `CarDetailsCard` has the `renewal_pending` case?

### Issue: Garage page still not loading
**Check:**
- Frontend changes deployed/refreshed?
- Check console for specific error
- Verify `getCars()` API response structure

---

## Deployment Checklist

- [x] Backend changes committed and pushed
- [x] Frontend changes committed and pushed
- [ ] Backend restarted locally
- [ ] Frontend refreshed locally (Cmd+Shift+R)
- [ ] All tests passed locally
- [ ] Deploy to Render (backend)
- [ ] Deploy to Vercel/Frontend host
- [ ] Test on live site
