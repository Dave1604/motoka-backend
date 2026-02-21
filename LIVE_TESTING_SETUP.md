# 🧪 LIVE TESTING SETUP - TEMPORARY PRICES

## ✅ CONFIRMED:
1. **Vehicle License is NOT mandatory** - You can uncheck it and pay for other documents only
2. **Transaction History works** - Shows orders with items purchased
3. **All systems ready** for live testing

---

## 📋 SETUP INSTRUCTIONS:

### STEP 1: Backup Current Prices (CRITICAL!)
Go to Supabase SQL Editor and run:
```sql
-- Save these results! You'll need them to restore later
SELECT 
    id,
    schedule_name,
    price as price_kobo,
    ROUND(price/100.0, 2) as price_naira,
    payment_head_id
FROM payment_schedules
ORDER BY id;

SELECT 
    id,
    code,
    state_name,
    delivery_fee as fee_kobo,
    ROUND(delivery_fee/100.0, 2) as fee_naira
FROM states
ORDER BY state_name;
```

**SAVE THE RESULTS TO A TEXT FILE!** You need these to restore prices later.

---

### STEP 2: Set Test Prices
Run this in Supabase SQL Editor:
```sql
-- Set all payment items to ₦1,000
UPDATE payment_schedules 
SET price = 100000
WHERE price IS NOT NULL;

-- Set all delivery fees to ₦500
UPDATE states 
SET delivery_fee = 50000
WHERE delivery_fee IS NOT NULL;

-- Verify changes
SELECT 
    schedule_name,
    ROUND(price/100.0, 2) as price_naira
FROM payment_schedules
ORDER BY id;

SELECT 
    state_name,
    ROUND(delivery_fee/100.0, 2) as delivery_fee_naira
FROM states
WHERE state_name IN ('Lagos', 'Abuja', 'Rivers')
ORDER BY state_name;
```

You should see:
- All items: ₦1,000
- All delivery: ₦500

---

### STEP 3: Test on Live Site
Once frontend is up:

1. **Login** to https://www.motokaapp.ng
2. **Go to Licenses** → Renew License
3. **Uncheck "Vehicle License"** (test that it's optional)
4. **Select other documents** (Insurance, Proof of Ownership, etc.)
5. **Complete payment** with Paystack Live
6. **Check transaction history**: Settings → Payment & Billing → Transaction History
7. **Verify items show** in the order

---

### STEP 4: Restore Original Prices (After Testing)
1. Open the backup file you saved in Step 1
2. Run UPDATE commands to restore each price:

```sql
-- Example (use your actual backup values):
UPDATE payment_schedules SET price = 1500000 WHERE id = 1;  -- Example: ₦15,000
UPDATE payment_schedules SET price = 1000000 WHERE id = 2;  -- Example: ₦10,000
-- ... etc for all schedules

UPDATE states SET delivery_fee = 600000 WHERE code = 'LA';  -- Example: ₦6,000 for Lagos
UPDATE states SET delivery_fee = 500000 WHERE code = 'FC';  -- Example: ₦5,000 for Abuja
-- ... etc for all states
```

---

## 🎯 TESTING CHECKLIST:

- [ ] Backup original prices (saved to file)
- [ ] Set test prices (₦1,000 items, ₦500 delivery)
- [ ] Frontend deployed with env vars
- [ ] Paystack webhook URL updated
- [ ] Login works
- [ ] Can deselect Vehicle License
- [ ] Can select other documents
- [ ] Payment completes successfully
- [ ] Order shows in transaction history with items
- [ ] Restore original prices after testing

---

## 💡 EXAMPLE TEST TRANSACTION:

**Select:**
- Insurance: ₦1,000
- Proof of Ownership: ₦1,000  
- Road Worthiness: ₦1,000

**Delivery:** Lagos - ₦500

**Total:** ₦3,500

This tests:
✅ Multiple items
✅ Vehicle License NOT required
✅ Delivery fee calculation
✅ Transaction history with items
