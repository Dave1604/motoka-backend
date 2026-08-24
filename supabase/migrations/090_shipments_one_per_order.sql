-- One courier booking per Motoka order. Prevents two Generate waybill clicks
-- from charging the Terminal wallet twice.

DELETE FROM public.shipments a
USING public.shipments b
WHERE a.order_id IS NOT NULL
  AND a.order_id = b.order_id
  AND a.id <> b.id
  AND (
    (b.waybill_number IS NOT NULL AND a.waybill_number IS NULL)
    OR (a.waybill_number IS NOT DISTINCT FROM b.waybill_number AND a.created_at < b.created_at)
    OR (b.waybill_number IS NOT NULL AND a.waybill_number IS NOT NULL AND a.created_at < b.created_at)
  );

DELETE FROM public.shipments a
USING public.shipments b
WHERE a.guest_order_id IS NOT NULL
  AND a.guest_order_id = b.guest_order_id
  AND a.id <> b.id
  AND (
    (b.waybill_number IS NOT NULL AND a.waybill_number IS NULL)
    OR (a.waybill_number IS NOT DISTINCT FROM b.waybill_number AND a.created_at < b.created_at)
    OR (b.waybill_number IS NOT NULL AND a.waybill_number IS NOT NULL AND a.created_at < b.created_at)
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_shipments_one_per_order
  ON public.shipments (order_id)
  WHERE order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_shipments_one_per_guest_order
  ON public.shipments (guest_order_id)
  WHERE guest_order_id IS NOT NULL;
