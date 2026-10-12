import { getSupabaseAdmin } from '../../config/supabase.js';
import { logInfo, logError, logDebug } from '../../utils/logger.js';
import {
  RENEWAL_WINDOW_DAYS,
  daysUntil,
} from './scheduling.util.js';
import { sendAdminOrderAlert } from '../email/adminOrderAlert.service.js';
import { sendAdminGuestOrderAlert } from '../email/adminOrderAlert.service.js';
import { sendOrderInProgressEmail } from '../email/paymentEmail.service.js';
import { sendGuestPaymentConfirmationEmail } from '../email/paymentEmail.service.js';
import { getRenewalItems } from './renewalItems.service.js';

const isoDay = (d) => d.toISOString().slice(0, 10);
const todayIso = () => isoDay(new Date());

class RenewalSweeper {
  constructor() {
    this.intervalMs = parseInt(process.env.RENEWAL_SWEEPER_INTERVAL_MS || '3600000', 10);
    this.batchSize = parseInt(process.env.RENEWAL_SWEEPER_BATCH_SIZE || '50', 10);
    this.tickInterval = null;
    this.isRunning = false;
    this.isTicking = false;
    this.stats = { ticks: 0, released: 0, pushed: 0, guestReleased: 0, guestReminded: 0, errors: 0 };
  }

  start() {
    if (this.isRunning) return;
    if (process.env.RENEWAL_SWEEPER_ENABLED === 'false') {
      logInfo('[Renewal Sweeper] Disabled via RENEWAL_SWEEPER_ENABLED=false');
      return;
    }
    this.isRunning = true;
    this.tick().catch((err) => logError('[Renewal Sweeper] Initial tick failed', { error: err.message }));
    this.tickInterval = setInterval(() => {
      this.tick().catch((err) => logError('[Renewal Sweeper] Tick failed', { error: err.message }));
    }, this.intervalMs);
    logInfo('[Renewal Sweeper] Starting', { intervalMs: this.intervalMs });
  }

  stop() {
    if (!this.isRunning) return;
    clearInterval(this.tickInterval);
    this.tickInterval = null;
    this.isRunning = false;
  }

  async tick() {
    if (this.isTicking) return;
    this.isTicking = true;
    this.stats.ticks++;
    try {
      await this.sweepSignedInOrders();
      await this.sweepGuestOrders();
    } finally {
      this.isTicking = false;
    }
  }

  async sweepSignedInOrders() {
    const supabaseAdmin = getSupabaseAdmin();
    const { data: due, error } = await supabaseAdmin
      .from('renewal_orders')
      .select('id, order_number, user_id, car_id, previous_expiry_date, renewal_months, scheduled_for, amount_paid, processing_notes')
      .eq('status', 'scheduled')
      .lte('scheduled_for', todayIso())
      .order('scheduled_for', { ascending: true })
      .limit(this.batchSize);

    if (error) {
      this.stats.errors++;
      logError('[Renewal Sweeper] Signed-in query failed', { error: error.message });
      return;
    }

    for (const order of due || []) {
      await this.releaseSignedInOrder(supabaseAdmin, order).catch((err) => {
        this.stats.errors++;
        logError('[Renewal Sweeper] Release failed', { orderNumber: order.order_number, error: err.message });
      });
    }
  }

  async releaseSignedInOrder(supabaseAdmin, order) {
    const { data: car } = await supabaseAdmin
      .from('cars')
      .select('id, expiry_date, registration_no, plate_number, vehicle_make, vehicle_model')
      .eq('id', order.car_id)
      .maybeSingle();

    // Car renewed elsewhere (or expiry corrected) while held: push the hold
    // out to the new window instead of releasing stale work onto ops.
    if (car?.expiry_date && daysUntil(car.expiry_date) > RENEWAL_WINDOW_DAYS) {
      const pushed = isoDay(new Date(new Date(car.expiry_date).getTime() - RENEWAL_WINDOW_DAYS * 86400000));
      await supabaseAdmin
        .from('renewal_orders')
        .update({
          scheduled_for: pushed,
          processing_notes: [order.processing_notes, `[sweeper] Expiry moved to ${car.expiry_date}; hold pushed to ${pushed}.`]
            .filter(Boolean).join('\n'),
          updated_at: new Date().toISOString(),
        })
        .eq('id', order.id)
        .eq('status', 'scheduled');
      this.stats.pushed++;
      logInfo('[Renewal Sweeper] Hold pushed out (expiry moved)', { orderNumber: order.order_number, pushed });
      return;
    }

    const { error: flipError } = await supabaseAdmin
      .from('renewal_orders')
      .update({
        status: 'pending',
        scheduled_for: null,
        processing_notes: [order.processing_notes, `[sweeper] Window opened ${todayIso()} — released for processing.`]
          .filter(Boolean).join('\n'),
        updated_at: new Date().toISOString(),
      })
      .eq('id', order.id)
      .eq('status', 'scheduled');

    if (flipError) throw flipError;
    this.stats.released++;

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('email, first_name, last_name')
      .eq('id', order.user_id)
      .maybeSingle();
    const customerName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || 'Customer';

    await sendAdminOrderAlert({
      orderNumber: order.order_number,
      customerName,
      customerEmail: profile?.email || 'unknown',
      amountNaira: Number(order.amount_paid) || 0,
      reference: `scheduled-release:${order.order_number}`,
      paymentType: 'Scheduled renewal window opened',
      plateNumber: car?.plate_number || car?.registration_no,
    }).catch((err) => logError('[Renewal Sweeper] Ops alert failed (non-fatal)', { orderNumber: order.order_number, error: err.message }));

    if (profile?.email) {
      await sendOrderInProgressEmail({
        to: profile.email,
        firstName: profile.first_name || 'there',
        orderNumber: order.order_number,
        orderType: 'renewal_manual',
      }).catch((err) => logError('[Renewal Sweeper] Customer email failed (non-fatal)', { orderNumber: order.order_number, error: err.message }));
    }

    logInfo('[Renewal Sweeper] Order released to ops', { orderNumber: order.order_number });
  }

  async sweepGuestOrders() {
    const supabaseAdmin = getSupabaseAdmin();
    const { data: due, error } = await supabaseAdmin
      .from('guest_renewal_orders')
      .select('id, guest_email, guest_name, plate_number, total_amount, payment_reference, selected_items, linked_user_id, scheduled_for, metadata')
      .eq('payment_status', 'payment_success')
      .not('scheduled_for', 'is', null)
      .lte('scheduled_for', todayIso())
      .order('scheduled_for', { ascending: true })
      .limit(this.batchSize);

    if (error) {
      this.stats.errors++;
      logError('[Renewal Sweeper] Guest query failed', { error: error.message });
      return;
    }

    for (const order of due || []) {
      await this.releaseGuestOrder(supabaseAdmin, order).catch((err) => {
        this.stats.errors++;
        logError('[Renewal Sweeper] Guest release failed', { orderId: order.id, error: err.message });
      });
    }
  }

  async releaseGuestOrder(supabaseAdmin, order) {
    // Registration gate: unclaimed orders never reach ops. One reminder —
    // the receipt page already carries the signup/OTP claim CTA.
    if (!order.linked_user_id) {
      const meta = order.metadata && typeof order.metadata === 'object' ? order.metadata : {};
      if (!meta.claim_reminded_at) {
        const { data: items } = await supabaseAdmin
          .from('renewal_items')
          .select('id, name');
        const itemMap = new Map((items || []).map((i) => [i.id, i]));
        const documentNames = (order.selected_items || []).map((id) => itemMap.get(id)?.name).filter(Boolean);
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
        await sendGuestPaymentConfirmationEmail({
          to: order.guest_email,
          guestName: order.guest_name,
          reference: order.payment_reference,
          amount: order.total_amount,
          plateNumber: order.plate_number,
          documentNames,
          receiptUrl: null,
          accountCreated: true,
          scheduledFor: order.scheduled_for,
        }).catch((err) => logError('[Renewal Sweeper] Claim reminder failed (non-fatal)', { orderId: order.id, error: err.message }));
        await supabaseAdmin
          .from('guest_renewal_orders')
          .update({
            metadata: { ...meta, claim_reminded_at: new Date().toISOString() },
            updated_at: new Date().toISOString(),
          })
          .eq('id', order.id);
        this.stats.guestReminded++;
        logInfo('[Renewal Sweeper] Claim reminder sent', { orderId: order.id });
      } else {
        logDebug('[Renewal Sweeper] Still unclaimed — waiting', { orderId: order.id });
      }
      return;
    }

    const { error: flipError } = await supabaseAdmin
      .from('guest_renewal_orders')
      .update({ scheduled_for: null, updated_at: new Date().toISOString() })
      .eq('id', order.id)
      .not('scheduled_for', 'is', null);

    if (flipError) throw flipError;
    this.stats.guestReleased++;

    const { data: items } = await supabaseAdmin.from('renewal_items').select('id, name');
    const itemMap = new Map((items || []).map((i) => [i.id, i]));
    await sendAdminGuestOrderAlert({
      orderId: order.id,
      guestName: order.guest_name,
      guestEmail: order.guest_email,
      guestPhone: null,
      plateNumber: order.plate_number,
      totalAmountKobo: order.total_amount,
      deliveryFeeKobo: 0,
      documentNames: (order.selected_items || []).map((id) => itemMap.get(id)?.name).filter(Boolean),
      reference: `scheduled-release:${order.id}`,
    }).catch((err) => logError('[Renewal Sweeper] Guest ops alert failed (non-fatal)', { orderId: order.id, error: err.message }));

    logInfo('[Renewal Sweeper] Guest order released to ops', { orderId: order.id });
  }
}

export const renewalSweeper = new RenewalSweeper();

// POST /api/internal/sweeper/release — pg_cron trigger (migration 102).
// Shared-secret gated, NOT admin-authed: this is service-to-service.
// Responds 200 immediately and sweeps in the background, so a cold-starting
// instance still does the work after pg_net's short timeout gives up waiting.
export const releaseSweepHandler = async (req, res) => {
  const expected = process.env.INTERNAL_CRON_SECRET || '';
  if (!expected) {
    return res.status(503).json({ status: false, message: 'Sweeper trigger not configured' });
  }
  if (req.headers?.['x-cron-secret'] !== expected) {
    return res.status(401).json({ status: false, message: 'Unauthorized' });
  }
  res.status(200).json({ status: true, message: 'Sweep started' });
  renewalSweeper.tick().catch((err) =>
    logError('[Renewal Sweeper] Triggered tick failed', { error: err.message })
  );
};
