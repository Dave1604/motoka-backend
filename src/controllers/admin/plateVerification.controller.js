import { getSupabaseAdmin } from '../../config/supabase.js';
import { grantWalletBonus } from '../../services/wallet/wallet.service.js';
import * as response from '../../utils/responses.js';
import { logError, logInfo } from '../../utils/logger.js';

const BONUS_NAIRA = 2000;
const BONUS_KOBO = BONUS_NAIRA * 100;
const BONUS_EXPIRY_DAYS = 356;
const VERIFY_URL = 'https://verify.autoreg.ng/';

/**
 * GET /admin/plate-verifications?status=&page=&limit=&search=
 * List users in the plate verification queue.
 */
export const listPlateVerifications = async (req, res) => {
  try {
    const supabase = getSupabaseAdmin();
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const status = req.query.status || 'pending';
    const search = (req.query.search || '').trim();

    let query = supabase
      .from('profiles')
      .select('id, user_id, first_name, last_name, phone_number, email, plate_number, plate_verification_status, plate_verification_note, plate_verified_at, plate_bonus_credited, chassis_number, car_color, car_brand, car_model, car_year, created_at', { count: 'exact' })
      .not('plate_number', 'is', null)
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('plate_verification_status', status);
    }
    if (search) {
      query = query.ilike('plate_number', `%${search}%`);
    }

    const { data, error, count } = await query.range(offset, offset + limit - 1);

    if (error) throw error;

    return response.success(res, {
      verifications: data || [],
      pagination: {
        total: count || 0,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil((count || 0) / limit)),
      },
    }, 'Plate verifications retrieved');
  } catch (error) {
    logError('[Admin PlateVerification] list error', { error: error.message });
    return response.serverError(res, 'Failed to retrieve plate verifications');
  }
};

/**
 * POST /admin/plate-verifications/:userId/verify
 * Mark a user's plate as verified. Optionally capture car details seen on
 * autoreg.ng so the add-car flow can be pre-filled later.
 * Body: { note?: string, chassis_number?, car_color?, car_brand?, car_model?, car_year? }
 * This is where the ₦2,000 is granted — as restricted bonus money (migration
 * 114): spendable on renewals, never withdrawable, expiring in 356 days.
 */
export const verifyPlate = async (req, res) => {
  const supabase = getSupabaseAdmin();
  const { userId } = req.params;
  const { note, chassis_number, car_color, car_brand, car_model, car_year } = req.body;

  try {
    const { data: profile, error: fetchErr } = await supabase
      .from('profiles')
      .select('id, user_id, plate_number, plate_verification_status, plate_bonus_credited')
      .eq('id', userId)
      .maybeSingle();

    if (fetchErr || !profile) {
      return response.error(res, 'User not found', 404);
    }

    if (!profile.plate_number) {
      return response.error(res, 'User has no plate number on file', 400);
    }

    // A profile that is verified AND already paid is done. One that is verified
    // but un-granted (the grant below failed last time) may be re-submitted so
    // the admin can retry the credit — wallet_grant_bonus is idempotent.
    if (profile.plate_verification_status === 'verified' && profile.plate_bonus_credited) {
      return response.error(res, 'Plate already verified', 400);
    }

    const updatePayload = {
      plate_verification_status: 'verified',
      plate_verified_at: new Date().toISOString(),
      plate_verification_note: note || null,
      updated_at: new Date().toISOString(),
    };

    // Capture car details observed on autoreg.ng for pre-filling add-car later
    if (chassis_number != null) updatePayload.chassis_number = String(chassis_number).trim().toUpperCase();
    if (car_color != null) updatePayload.car_color = String(car_color).trim();
    if (car_brand != null) updatePayload.car_brand = String(car_brand).trim();
    if (car_model != null) updatePayload.car_model = String(car_model).trim();
    if (car_year != null) updatePayload.car_year = Number(car_year);

    const { error: updateErr } = await supabase
      .from('profiles')
      .update(updatePayload)
      .eq('id', userId);

    if (updateErr) throw updateErr;

    // Grant the ₦2,000 now that a human has confirmed the plate on autoreg.ng.
    // Idempotent on the reference, so a retry cannot double-pay.
    let bonusGranted = Boolean(profile.plate_bonus_credited);
    let bonusError = null;
    if (!bonusGranted) {
      try {
        await grantWalletBonus({
          userId: profile.id,
          amountKobo: BONUS_KOBO,
          expiresAt: new Date(Date.now() + BONUS_EXPIRY_DAYS * 86400000).toISOString(),
          reference: `PLATE_BONUS_${profile.id}`,
        });
        const { error: flagErr } = await supabase
          .from('profiles')
          .update({ plate_bonus_credited: true })
          .eq('id', userId);
        if (flagErr) logError('[Admin PlateVerification] Bonus flag set failed', { userId, error: flagErr.message });
        bonusGranted = true;
      } catch (walletErr) {
        // The plate stays verified — only the credit failed. Re-submitting the
        // same verify call retries just the grant.
        bonusError = walletErr.message;
        logError('[Admin PlateVerification] Bonus grant failed', { userId, error: walletErr.message });
      }
    }

    logInfo('[Admin PlateVerification] Verified', {
      userId,
      plateNumber: profile.plate_number,
      adminId: req.admin.id,
      hasCarDetails: Boolean(chassis_number || car_brand || car_model),
      bonusGranted,
    });

    return response.success(res, {
      user_id: profile.user_id,
      plate_number: profile.plate_number,
      status: 'verified',
      bonus_granted: bonusGranted,
      bonus_error: bonusError,
    }, bonusGranted
      ? `Plate verified — ₦${BONUS_NAIRA} bonus credited`
      : 'Plate verified — bonus credit FAILED, re-run verify to retry');
  } catch (error) {
    logError('[Admin PlateVerification] verify error', { userId, error: error.message });
    return response.serverError(res, 'Failed to verify plate');
  }
};

/**
 * POST /admin/plate-verifications/:userId/reject
 * Mark a user's plate as rejected. No money moves: nothing was granted at
 * signup, so there is nothing to claw back.
 * Body: { note: string (required) }
 */
export const rejectPlate = async (req, res) => {
  const supabase = getSupabaseAdmin();
  const { userId } = req.params;
  const { note } = req.body;

  try {
    if (!note || !String(note).trim()) {
      return response.error(res, 'A rejection reason is required', 400);
    }

    const { data: profile, error: fetchErr } = await supabase
      .from('profiles')
      .select('id, user_id, plate_number, plate_verification_status, plate_bonus_credited')
      .eq('id', userId)
      .maybeSingle();

    if (fetchErr || !profile) {
      return response.error(res, 'User not found', 404);
    }

    if (profile.plate_verification_status !== 'pending') {
      return response.error(res, `Plate already ${profile.plate_verification_status}`, 400);
    }

    const { error: updateErr } = await supabase
      .from('profiles')
      .update({
        plate_verification_status: 'rejected',
        plate_verification_note: String(note).trim(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);

    if (updateErr) throw updateErr;

    logInfo('[Admin PlateVerification] Rejected', {
      userId,
      plateNumber: profile.plate_number,
      reason: note,
      adminId: req.admin.id,
    });

    return response.success(res, {
      user_id: profile.user_id,
      plate_number: profile.plate_number,
      status: 'rejected',
    }, 'Plate rejected');
  } catch (error) {
    logError('[Admin PlateVerification] reject error', { userId, error: error.message });
    return response.serverError(res, 'Failed to reject plate');
  }
};

/**
 * GET /admin/plate-verifications/verify-url
 * Returns the external verification URL.
 */
export const getVerifyUrl = async (_req, res) => {
  return response.success(res, { url: VERIFY_URL }, 'Verification portal URL');
};
