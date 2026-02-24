-- Check if payment tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN (
  'payment_transactions',
  'renewal_orders',
  'payment_subscriptions',
  'renewal_items',
  'webhook_events',
  'states',
  'lgas'
)
ORDER BY table_name;

-- Check if renewal items are seeded
SELECT item_key, name, price, required FROM public.renewal_items;

-- Check if states are seeded
SELECT COUNT(*) as state_count FROM public.states;
