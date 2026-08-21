-- ============================================================
-- MIGRATION 066 – renewal_items price update (July 2026)
-- ============================================================
-- Directive (boss): the standard renewal base total should be ₦35,000 (not the
-- ₦34,500 from migration 040), then add ₦500 to each priced item.
--
--   Base fix : Vehicle Licence carries the ₦500 that lifts the base to ₦35,000.
--   Then     : +₦500 on each of the four priced items (Digital stays free).
--
-- Prices stored in KOBO (naira × 100). Hackney Permit is a commercial-only
-- item, not part of this standard set, so it is left unchanged.
--
--   Insurance                   : ₦15,000 → ₦15,500  (1,550,000 kobo)
--   Road Worthiness + Referral  : ₦11,500 → ₦12,000  (1,200,000 kobo)
--   Vehicle Licence             : ₦5,000  → ₦6,000    (600,000 kobo)   [+500 base +500 each]
--   Proof of Ownership          : ₦3,000  → ₦3,500    (350,000 kobo)
--   Keeping Digital Copy        : ₦0      → ₦0         (unchanged)
--   ── standard total: ₦37,000 ──
-- ============================================================

UPDATE public.renewal_items
  SET price = 1550000, updated_at = NOW()
  WHERE item_key = 'insurance';

UPDATE public.renewal_items
  SET price = 1200000, updated_at = NOW()
  WHERE item_key = 'road_worthiness';

UPDATE public.renewal_items
  SET price = 600000, updated_at = NOW()
  WHERE item_key = 'vehicle_licence';

UPDATE public.renewal_items
  SET price = 350000, updated_at = NOW()
  WHERE item_key = 'proof_of_ownership';
