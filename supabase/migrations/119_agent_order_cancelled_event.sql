-- MIGRATION 119 – Record a cancelled order in the agent's history
--
-- Cancelling an order now cancels its unpaid agent payout and takes it off the
-- agent's list. The history needs its own event type for that, so the record
-- does not read as a rejection of the agent's work.

ALTER TABLE public.agent_order_events DROP CONSTRAINT IF EXISTS agent_order_events_event_type_check;
ALTER TABLE public.agent_order_events ADD CONSTRAINT agent_order_events_event_type_check
  CHECK (event_type IN ('assigned','in_progress','submitted','completed','rejected','reassigned','cancelled'));
