-- ============================================
-- DEBUG TRANSACTION HISTORY FOR USER
-- ============================================

-- 1. Find user by email
SELECT id, user_id, email, first_name, last_name 
FROM profiles 
WHERE email = 'rasak@motoka.ng';

-- 2. Get all transactions for this user (using UUID from step 1)
-- Replace 'USER_UUID_HERE' with the id from query above
SELECT 
    id, reference, status,
    ROUND(amount/100.0, 2) as amount_naira,
    payment_type,
    created_at, paid_at
FROM payment_transactions
WHERE user_id = (SELECT id FROM profiles WHERE email = 'rasak@motoka.ng')
ORDER BY created_at DESC;

-- 3. Get orders for this user
SELECT 
    o.id, o.order_number, o.status,
    ROUND(o.amount_paid/100.0, 2) as amount_naira,
    o.transaction_id, o.created_at
FROM renewal_orders o
WHERE o.user_id = (SELECT id FROM profiles WHERE email = 'rasak@motoka.ng')
ORDER BY o.created_at DESC;

-- 4. Get renewal items for orders
SELECT 
    ri.order_id, ri.name, ri.quantity,
    ROUND(ri.price/100.0, 2) as price_naira,
    o.order_number
FROM renewal_order_items ri
JOIN renewal_orders o ON ri.order_id = o.id
WHERE o.user_id = (SELECT id FROM profiles WHERE email = 'rasak@motoka.ng')
ORDER BY o.created_at DESC;

-- 5. Check user's cars and pending orders
SELECT 
    c.id, c.slug, c.registration_no, c.status,
    c.expiry_date,
    ro.order_number, ro.status as order_status
FROM cars c
LEFT JOIN renewal_orders ro ON ro.car_id = c.id AND ro.status IN ('pending', 'processing')
WHERE c.user_id = (SELECT id FROM profiles WHERE email = 'rasak@motoka.ng')
ORDER BY c.created_at DESC;
