-- Check Kwara state
SELECT id, name, code, delivery_fee, is_active FROM states WHERE name = 'Kwara';

-- Check state ID 23
SELECT id, name, code, delivery_fee FROM states WHERE id = 23;

-- Check LGAs for Kwara
SELECT lg.id, lg.name, lg.state_id 
FROM local_governments lg
JOIN states s ON s.id = lg.state_id
WHERE s.name = 'Kwara'
ORDER BY lg.name
LIMIT 10;

-- Check all states count
SELECT COUNT(*) as total_states FROM states;
