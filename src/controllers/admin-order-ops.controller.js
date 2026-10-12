import { getSupabaseAdmin } from '../config/supabase.js';
import { logError, logInfo } from '../utils/logger.js';
import { RENEWAL_WINDOW_DAYS, daysUntil } from '../services/payment/scheduling.util.js';

const isoDay = (d) => d.toISOString().slice(0, 10);

// POST /api/admin/orders/:orderNumber/rollover { new_expiry_date: 'YYYY-MM-DD' }
//
// The incident case: a customer paid for a cycle that got fulfilled elsewhere
// and asked for the payment to count for the year to come. The car's validity
// moves to new_expiry_date and the paid order re-anchors to the following
// cycle — held as scheduled, or pending when already inside the window.
export const rollOrderToNextCycle = async (req, res) => {
  try {
    const { orderNumber } = req.params;
    const { new_expiry_date } = req.body || {};
    if (!orderNumber) return res.status(400).json({ status: false, message: 'Order number is required' });

    const expiry = new_expiry_date ? new Date(new_expiry_date) : null;
    if (!expiry || Number.isNaN(expiry.getTime())) {
      return res.status(400).json({ status: false, message: 'A valid new_expiry_date (YYYY-MM-DD) is required' });
    }
    const newExpiry = isoDay(expiry);

    const supabaseAdmin = getSupabaseAdmin();
    const { data: order } = await supabaseAdmin
      .from('renewal_orders')
      .select('id, order_number, status, car_id, renewal_months, previous_expiry_date, scheduled_for, processing_notes')
      .eq('order_number', orderNumber)
      .maybeSingle();

    if (!order) return res.status(404).json({ status: false, message: 'Order not found' });
    if (['completed', 'cancelled'].includes(order.status)) {
      return res.status(409).json({ status: false, message: `Cannot roll over a ${order.status} order` });
    }

    const { error: carError } = await supabaseAdmin
      .from('cars')
      .update({ expiry_date: newExpiry, updated_at: new Date().toISOString() })
      .eq('id', order.car_id);
    if (carError) {
      return res.status(500).json({ status: false, message: 'Could not update car expiry' });
    }

    const inWindow = daysUntil(newExpiry) <= RENEWAL_WINDOW_DAYS;
    const nextStatus = inWindow ? 'pending' : 'scheduled';
    const nextScheduledFor = inWindow
      ? null
      : isoDay(new Date(new Date(newExpiry).getTime() - RENEWAL_WINDOW_DAYS * 86400000));

    const { data: updated, error: orderError } = await supabaseAdmin
      .from('renewal_orders')
      .update({
        status: nextStatus,
        scheduled_for: nextScheduledFor,
        previous_expiry_date: newExpiry,
        processing_notes: [order.processing_notes, `[rollover] Cycle moved to start ${newExpiry} (fulfilled elsewhere); ${inWindow ? 'actionable now' : `held to ${nextScheduledFor}`}.`]
          .filter(Boolean).join('\n'),
        updated_at: new Date().toISOString(),
      })
      .eq('id', order.id)
      .select('id, order_number, status, scheduled_for, previous_expiry_date')
      .single();

    if (orderError) {
      logError('[Admin] Rollover failed', { orderNumber, error: orderError.message });
      return res.status(500).json({ status: false, message: 'Could not roll over order' });
    }

    logInfo('[Admin] Order rolled to next cycle', { orderNumber, newExpiry, nextStatus });
    return res.json({ status: true, data: updated });
  } catch (error) {
    logError('[Admin] Rollover error', { error: error.message });
    return res.status(500).json({ status: false, message: 'Failed to roll over order' });
  }
};

// POST /api/admin/guest-orders/:id/rollover { scheduled_for: 'YYYY-MM-DD' }
//
// Guest variant: no car record to move, so the hold date is set directly.
// Pass scheduled_for: null to release immediately (still gated on registration).
export const rollGuestOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const { scheduled_for } = req.body || {};
    if (!id) return res.status(400).json({ status: false, message: 'Order id is required' });

    const supabaseAdmin = getSupabaseAdmin();
    const { data: order } = await supabaseAdmin
      .from('guest_renewal_orders')
      .select('id, payment_status, scheduled_for, metadata')
      .eq('id', id)
      .maybeSingle();

    if (!order) return res.status(404).json({ status: false, message: 'Guest order not found' });
    if (order.payment_status !== 'payment_success') {
      return res.status(409).json({ status: false, message: `Only paid orders can be rolled (status: ${order.payment_status})` });
    }

    let nextScheduledFor = null;
    if (scheduled_for) {
      const d = new Date(scheduled_for);
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({ status: false, message: 'scheduled_for must be a valid date (YYYY-MM-DD) or null' });
      }
      nextScheduledFor = isoDay(d);
    }

    const meta = order.metadata && typeof order.metadata === 'object' ? order.metadata : {};
    const { data: updated, error } = await supabaseAdmin
      .from('guest_renewal_orders')
      .update({
        scheduled_for: nextScheduledFor,
        metadata: {
          ...meta,
          rollover: { at: new Date().toISOString(), from: order.scheduled_for || null, to: nextScheduledFor },
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('id, payment_status, scheduled_for')
      .single();

    if (error) {
      logError('[Admin] Guest rollover failed', { id, error: error.message });
      return res.status(500).json({ status: false, message: 'Could not roll over guest order' });
    }

    logInfo('[Admin] Guest order rolled over', { id, nextScheduledFor });
    return res.json({ status: true, data: updated });
  } catch (error) {
    logError('[Admin] Guest rollover error', { error: error.message });
    return res.status(500).json({ status: false, message: 'Failed to roll over guest order' });
  }
};
