# Payment System Overview

## What It Does

The payment system handles vehicle document renewal payments through Paystack integration. It supports one-time payments, subscriptions, and order management.

## Core Features

### Payment Processing
- **One-time payments** for vehicle document renewals
- **Paystack integration** for secure payment processing
- **Payment verification** with automatic webhook handling
- **Payment retry** for failed transactions
- **Payment cancellation** for abandoned transactions

### Renewal Items
- Vehicle Licence (required)
- Road Worthiness
- Insurance
- Referral
- Proof of Ownership

### Orders
- Automatic order creation on successful payment
- Order tracking and status management
- Order history per user
- Order receipts

### Subscriptions
- Automatic recurring payments (annual, biannual, quarterly)
- Subscription management (pause, resume, cancel)
- Subscription history

### Delivery
- State and LGA selection
- Automatic delivery fee calculation
- Delivery address management

## Payment Flow

1. User selects renewal items and delivery details
2. System calculates total (items + delivery fee)
3. Payment initialized with Paystack
4. User redirected to Paystack payment page
5. After payment, webhook updates transaction status
6. Order automatically created on success
7. User receives confirmation email

## Security Features

- Webhook signature verification
- Rate limiting on payment endpoints
- User ownership verification
- Environment-based callback URLs (prevents phishing)
- Secure metadata handling

## Status Flow

```
pending → successful/failed/abandoned
```

- **pending**: Payment initialized, awaiting completion
- **successful**: Payment completed, order created
- **failed**: Payment failed on Paystack
- **abandoned**: User canceled or payment expired
