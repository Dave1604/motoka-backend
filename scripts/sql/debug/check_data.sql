-- Check if states are seeded
SELECT COUNT(*) as state_count FROM states;

-- Check if renewal items are seeded  
SELECT item_key, name, price, required FROM renewal_items ORDER BY item_key;
