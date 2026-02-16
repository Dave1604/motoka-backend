-- ============================================
-- CHECK CURRENT PRICES AND PAYMENT DATA
-- ============================================

-- 1. Check renewal item prices
SELECT 
    item_key,
    name,
    ROUND(price/100.0, 2) as price_naira,
    required
FROM renewal_items
ORDER BY id;

-- 2. Check state delivery fees (sample)
SELECT 
    code,
    name as state_name,
    ROUND(delivery_fee/100.0, 2) as delivery_fee_naira
FROM states
WHERE name IN ('Lagos', 'Abuja', 'Rivers', 'Oyo', 'Kano')
ORDER BY name;

-- 3. Check all payment transactions
SELECT 
    id,
    reference,
    status,
    ROUND(amount/100.0, 2) as amount_naira,
    payment_type,
    created_at,
    paid_at
FROM payment_transactions
ORDER BY created_at DESC
LIMIT 10;

-- 4. Check all renewal orders
SELECT 
    id,
    order_number,
    status,
    ROUND(amount_paid/100.0, 2) as amount_naira,
    transaction_id,
    created_at
FROM renewal_orders
ORDER BY created_at DESC
LIMIT 10;

-- 5. Count total transactions and orders
SELECT 
    (SELECT COUNT(*) FROM payment_transactions) as total_transactions,
    (SELECT COUNT(*) FROM renewal_orders) as total_orders,
    (SELECT COUNT(*) FROM payment_transactions WHERE status = 'successful') as successful_payments,
    (SELECT COUNT(*) FROM renewal_orders WHERE status = 'pending') as pending_orders;
