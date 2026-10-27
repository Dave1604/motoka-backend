-- =============================================
-- MIGRATION 112 – Lagos-specific renewal price override
-- =============================================
-- Road worthiness renewals in Lagos require a VIO inspection and carry a
-- one-time 30-day referral window (referral becomes invalid after inspection).
-- Lagos pricing is higher than the standard renewal base: road worthiness +
-- referral = ₦15,000 (1,500,000 kobo).

ALTER TABLE public.renewal_items
  ADD COLUMN IF NOT EXISTS price_lagos BIGINT;

UPDATE public.renewal_items
  SET price_lagos = 1500000, updated_at = NOW()
  WHERE item_key = 'road_worthiness';

CREATE INDEX IF NOT EXISTS idx_renewal_items_price_lagos ON public.renewal_items(price_lagos);
