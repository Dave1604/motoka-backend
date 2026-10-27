import { getSupabaseAdmin } from '../../config/supabase.js';
import { adminAdjustWallet } from '../../services/wallet/wallet.service.js';
import { randomUUID } from 'crypto';
import * as response from '../../utils/responses.js';
import { logError, logInfo } from '../../utils/logger.js';

const BONUS_NAIRA = 2000;
const BONUS_KOBO = BONUS_NAIRA * 100;
const VERIFY_URL = 'https://verify.autoreg.ng/';

/**
 * GET /admin/plate-verifications?status=&page=&limit=&search=
 * List users awaiting plate verification.
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
      .select('id, user_id, first_name, last_name, phone_number, email, plate_number, plate_verification_status, plate_verification_note, plate_verified_at, plate_bonus_credited, created_at', { count: 'exact' })
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
 * Mark a user's plate as verified and credit ₦2,000 to their wallet.
 * Body: { note?: string }
 */
export const verifyPlate = async (req, res) => {
  const supabase = getSupabaseAdmin();
  const { userId } = req.params;
  const { note } = req.body;

  try {
    const { data: profile, error: fetchErr } = await supabase
      .from('profiles')
      .select('id, user_id, first_name, last_name, phone_number, email, plate_number, plate_verification_status, plate_bonus_credited')
      .eq('id', userId)
      .maybeSingle();

    if (fetchErr || !profile) {
      return response.error(res, 'User not found', 404);
    }

    if (!profile.plate_number) {
      return response.error(res, 'User has no plate number on file', 400);
    }

    if (profile.plate_verification_status === 'verified') {
      return response.error(res, 'Plate already verified', 400);
    }

    if (profile.plate_bonus_credited) {
      return response.error(res, 'Bonus already credited for this user', 400);
    }

    const { error: updateErr } = await supabase
      .from('profiles')
      .update({
        plate_verification_status: 'verified',
        plate_verified_at: new Date().toISOString(),
        plate_verification_note: note || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);

    if (updateErr) throw updateErr;

    const reference = `PLATE_VERIFY_${randomUUID()}`;
    const result = await adminAdjustWallet({
      userId: profile.id,
      direction: 'credit',
      amountKobo: BONUS_KOBO,
      adminId: req.admin.id,
      note: `₦${BONUS_NAIRA} signup bonus — plate ${profile.plate_number} verified. ${note || ''}`.trim(),
      reference,
    });

    const { error: creditErr } = await supabase
      .from('profiles')
      .update({ plate_bonus_credited: true })
      .eq('id', userId);

    if (creditErr) {
      logError('[Admin PlateVerification] Bonus credited but flag update failed', {
        userId,
        error: creditErr.message,
      });
    }

    logInfo('[Admin PlateVerification] Verified + bonus credited', {
      userId,
      plateNumber: profile.plate_number,
      amountKobo: BONUS_KOBO,
      adminId: req.admin.id,
      reference,
    });

    return response.success(res, {
      user_id: profile.user_id,
      plate_number: profile.plate_number,
      status: 'verified',
      amount_naira: BONUS_NAIRA,
      amount_kobo: BONUS_KOBO,
      balance_after: result.balanceAfter,
    }, `Plate verified — ₦${BONUS_NAIRA} credited to wallet`);
  } catch (error) {
    logError('[Admin PlateVerification] verify error', { userId, error: error.message });
    return response.serverError(res, 'Failed to verify plate');
  }
};

/**
 * POST /admin/plate-verifications/:userId/reject
 * Mark a user's plate as rejected. Body: { note: string (required) }
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
      .select('id, plate_number, plate_verification_status')
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
    }, 'Plate verification rejected');
  } catch (error) {
    logError('[Admin PlateVerification] reject error', { userId, error: error.message });
    return response.serverError(res, 'Failed to reject plate');
  }
};

/**
 * GET /admin/plate-verifications/verify-url
 * Returns the external verification URL so the frontend can open it.
 */
export const getVerifyUrl = async (_req, res) => {
  return response.success(res, { url: VERIFY_URL }, 'Verification portal URL');
};
