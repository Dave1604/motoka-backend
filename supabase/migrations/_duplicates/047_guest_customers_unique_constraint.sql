-- Fix: add a composite unique constraint on guest_customers(email, plate_number)
-- so that concurrent requests or network retries cannot create duplicate rows.
-- The service-layer upsert already does a SELECT → INSERT, but without this
-- constraint a race condition can produce duplicates.  The ON CONFLICT clause
-- in the query will now be able to use this constraint for an atomic upsert.

ALTER TABLE public.guest_customers
  ADD CONSTRAINT uq_guest_customers_email_plate UNIQUE (email, plate_number);
