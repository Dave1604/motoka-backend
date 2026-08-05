import { getSupabaseAdmin } from '../../config/supabase.js';
import { logError, logInfo, logWarn } from '../../utils/logger.js';
import { creditWallet } from '../wallet/wallet.service.js';
import { createInAppNotification } from '../notification.service.js';
import { PAYMENT_STATUS, PAYMENT_TYPE } from '../../constants/payment.constants.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const CODE_LENGTH = 8;

/** Payment types that do NOT unlock referral rewards */
const NON_QUALIFYING_TYPES = new Set([
  PAYMENT_TYPE.WALLET_FUNDING,
  PAYMENT_TYPE.TOKENIZATION,
]);

export class ReferralError extends Error {
  constructor(message, statusCode = 400, code = 'REFERRAL_ERROR') {
    super(message);
    this.name = 'ReferralError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function generateCode() {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

export async function getSettings() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('referral_settings')
    .select('*')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw new ReferralError(`Failed to read referral settings: ${error.message}`, 500);
  return data || {
    id: 1,
    referrer_reward_kobo: 30000,
    referee_reward_kobo: 30000,
    is_active: true,
    max_rewards_per_referrer: null,
  };
}

export async function updateSettings({
  referrerRewardKobo,
  refereeRewardKobo,
  isActive,
  maxRewardsPerReferrer,
  adminId,
}) {
  const supabase = getSupabaseAdmin();
  const patch = { updated_at: new Date().toISOString() };
  if (referrerRewardKobo !== undefined) patch.referrer_reward_kobo = referrerRewardKobo;
  if (refereeRewardKobo !== undefined) patch.referee_reward_kobo = refereeRewardKobo;
  if (isActive !== undefined) patch.is_active = isActive;
  if (maxRewardsPerReferrer !== undefined) {
    patch.max_rewards_per_referrer = maxRewardsPerReferrer;
  }
  if (adminId) patch.updated_by = adminId;

  const { data, error } = await supabase
    .from('referral_settings')
    .update(patch)
    .eq('id', 1)
    .select('*')
    .single();

  if (error) throw new ReferralError(`Failed to update referral settings: ${error.message}`, 500);
  return data;
}

/**
 * Lazy-create a unique referral code for a user.
 */
export async function ensureReferralCode(userId) {
  const supabase = getSupabaseAdmin();
  const { data: existing, error: readErr } = await supabase
    .from('referral_codes')
    .select('id, user_id, code, created_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (readErr) throw new ReferralError(`Failed to read referral code: ${readErr.message}`, 500);
  if (existing) return existing;

  for (let attempt = 0; attempt < 12; attempt++) {
    const code = generateCode();
    const { data, error } = await supabase
      .from('referral_codes')
      .insert({ user_id: userId, code })
      .select('id, user_id, code, created_at')
      .single();

    if (!error && data) return data;
    if (error?.code === '23505') continue; // unique collision — retry
    throw new ReferralError(`Failed to create referral code: ${error?.message}`, 500);
  }
  throw new ReferralError('Failed to allocate a unique referral code', 500);
}

/**
 * Attribute a new user to a referrer via code. Non-fatal on soft failures
 * (invalid/inactive code) so signup never fails because of referral.
 */
export async function attributeReferral({ refereeId, code }) {
  if (!code || !refereeId) return { attributed: false, reason: 'missing' };

  const normalized = String(code).trim().toUpperCase();
  if (!/^[A-Z0-9]{6,12}$/.test(normalized)) {
    return { attributed: false, reason: 'invalid_format' };
  }

  const supabase = getSupabaseAdmin();
  const settings = await getSettings();
  if (!settings.is_active) {
    return { attributed: false, reason: 'inactive' };
  }

  const { data: codeRow, error: codeErr } = await supabase
    .from('referral_codes')
    .select('user_id, code')
    .eq('code', normalized)
    .maybeSingle();

  if (codeErr) {
    logError('[Referral] code lookup failed', { error: codeErr, code: normalized });
    return { attributed: false, reason: 'lookup_error' };
  }
  if (!codeRow) return { attributed: false, reason: 'not_found' };
  if (codeRow.user_id === refereeId) {
    return { attributed: false, reason: 'self_referral' };
  }

  const { data: existing } = await supabase
    .from('referrals')
    .select('id')
    .eq('referee_id', refereeId)
    .maybeSingle();
  if (existing) return { attributed: false, reason: 'already_attributed' };

  const { data: inserted, error: insertErr } = await supabase
    .from('referrals')
    .insert({
      referrer_id: codeRow.user_id,
      referee_id: refereeId,
      referral_code: normalized,
      status: 'pending',
    })
    .select('id, referrer_id, referee_id, referral_code, status')
    .single();

  if (insertErr) {
    // Unique on referee — race
    if (insertErr.code === '23505') {
      return { attributed: false, reason: 'already_attributed' };
    }
    logError('[Referral] attribute insert failed', { error: insertErr, refereeId });
    return { attributed: false, reason: 'insert_error' };
  }

  logInfo('[Referral] attributed', {
    referralId: inserted.id,
    referrerId: inserted.referrer_id,
    refereeId: inserted.referee_id,
    code: normalized,
  });

  return { attributed: true, referral: inserted };
}

export async function validateReferralCode(code) {
  const normalized = String(code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{6,12}$/.test(normalized)) {
    return { valid: false, reason: 'invalid_format' };
  }
  const settings = await getSettings();
  if (!settings.is_active) {
    return { valid: false, reason: 'inactive' };
  }
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('referral_codes')
    .select('code')
    .eq('code', normalized)
    .maybeSingle();
  if (!data) return { valid: false, reason: 'not_found' };
  return { valid: true, code: data.code };
}

function isQualifyingTransaction(transaction) {
  const type = transaction?.payment_type;
  if (!type) return false;
  if (NON_QUALIFYING_TYPES.has(type)) return false;
  // Also check metadata.payment_type for wallet funding edge cases
  const meta =
    typeof transaction.metadata === 'string'
      ? (() => {
          try {
            return JSON.parse(transaction.metadata);
          } catch {
            return {};
          }
        })()
      : transaction.metadata || {};
  if (meta.payment_type && NON_QUALIFYING_TYPES.has(meta.payment_type)) return false;
  return true;
}

/**
 * Called from payment success side-effects. Credits both wallets once when
 * the referee completes their first qualifying purchase.
 * Must never throw into the payment path — callers should catch, but we
 * also swallow internally and return a result object.
 */
export async function qualifyAndRewardOnFirstPurchase({ userId, transaction }) {
  try {
    if (!userId || !transaction?.id) {
      return { rewarded: false, reason: 'missing_input' };
    }
    if (!isQualifyingTransaction(transaction)) {
      return { rewarded: false, reason: 'non_qualifying_payment' };
    }

    const supabase = getSupabaseAdmin();

    const { data: referral, error: refErr } = await supabase
      .from('referrals')
      .select('*')
      .eq('referee_id', userId)
      .eq('status', 'pending')
      .maybeSingle();

    if (refErr) {
      logError('[Referral] pending lookup failed', { error: refErr, userId });
      return { rewarded: false, reason: 'lookup_error' };
    }
    if (!referral) {
      return { rewarded: false, reason: 'no_pending_referral' };
    }

    // First qualifying purchase? (current txn already successful)
    const { count, error: countErr } = await supabase
      .from('payment_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', PAYMENT_STATUS.SUCCESSFUL)
      .neq('id', transaction.id)
      .neq('payment_type', PAYMENT_TYPE.WALLET_FUNDING)
      .neq('payment_type', PAYMENT_TYPE.TOKENIZATION);

    if (countErr) {
      logError('[Referral] prior purchase count failed', { error: countErr, userId });
      return { rewarded: false, reason: 'count_error' };
    }
    if ((count || 0) > 0) {
      // Not first purchase — leave pending? Better: leave pending so a bug
      // in prior detection could still reward? No — if they already paid
      // before without us catching it, mark rejected to avoid surprise credits later.
      logWarn('[Referral] referee already had prior purchases; marking rejected', {
        referralId: referral.id,
        priorCount: count,
      });
      await supabase
        .from('referrals')
        .update({
          status: 'rejected',
          fraud_notes: `Skipped: referee had ${count} prior qualifying purchase(s)`,
        })
        .eq('id', referral.id)
        .eq('status', 'pending');
      return { rewarded: false, reason: 'not_first_purchase' };
    }

    const settings = await getSettings();
    if (!settings.is_active) {
      return { rewarded: false, reason: 'inactive' };
    }

    if (settings.max_rewards_per_referrer != null) {
      const { count: rewardedCount, error: capErr } = await supabase
        .from('referrals')
        .select('id', { count: 'exact', head: true })
        .eq('referrer_id', referral.referrer_id)
        .eq('status', 'rewarded');
      if (capErr) {
        logError('[Referral] cap count failed', { error: capErr });
        return { rewarded: false, reason: 'cap_error' };
      }
      if ((rewardedCount || 0) >= settings.max_rewards_per_referrer) {
        await supabase
          .from('referrals')
          .update({
            status: 'rejected',
            fraud_notes: 'Referrer hit max_rewards_per_referrer cap',
            qualifying_transaction_id: transaction.id,
            qualifying_reference: transaction.reference,
            qualified_at: new Date().toISOString(),
          })
          .eq('id', referral.id)
          .eq('status', 'pending');
        return { rewarded: false, reason: 'referrer_cap' };
      }
    }

    const referrerAmount = Number(settings.referrer_reward_kobo) || 0;
    const refereeAmount = Number(settings.referee_reward_kobo) || 0;

    // Mark qualified first (optimistic lock on pending)
    const { data: qualified, error: qualErr } = await supabase
      .from('referrals')
      .update({
        status: 'qualified',
        qualifying_transaction_id: transaction.id,
        qualifying_reference: transaction.reference,
        qualified_at: new Date().toISOString(),
        referrer_reward_kobo: referrerAmount,
        referee_reward_kobo: refereeAmount,
      })
      .eq('id', referral.id)
      .eq('status', 'pending')
      .select('*')
      .maybeSingle();

    if (qualErr || !qualified) {
      // Another worker already moved it
      return { rewarded: false, reason: 'already_processed' };
    }

    if (referrerAmount > 0) {
      await creditWallet({
        userId: referral.referrer_id,
        amountKobo: referrerAmount,
        reason: 'referral',
        reference: `referral:${referral.id}:referrer`,
        transactionId: transaction.id,
        note: `Referral reward for inviting user (referral #${referral.id})`,
      });
    }

    if (refereeAmount > 0) {
      await creditWallet({
        userId: referral.referee_id,
        amountKobo: refereeAmount,
        reason: 'referral',
        reference: `referral:${referral.id}:referee`,
        transactionId: transaction.id,
        note: `Welcome referral bonus (referral #${referral.id})`,
      });
    }

    await supabase
      .from('referrals')
      .update({
        status: 'rewarded',
        rewarded_at: new Date().toISOString(),
      })
      .eq('id', referral.id);

    const naira = (kobo) => `₦${(kobo / 100).toLocaleString('en-NG')}`;

    await Promise.all([
      createInAppNotification(
        referral.referrer_id,
        'referral',
        'referral_reward',
        `You earned ${naira(referrerAmount)} for a successful referral!`,
        { referral_id: referral.id, amount_kobo: referrerAmount }
      ).catch((e) => logWarn('[Referral] referrer notif failed', { error: e?.message })),
      createInAppNotification(
        referral.referee_id,
        'referral',
        'referral_welcome_bonus',
        `You received ${naira(refereeAmount)} referral bonus in your wallet!`,
        { referral_id: referral.id, amount_kobo: refereeAmount }
      ).catch((e) => logWarn('[Referral] referee notif failed', { error: e?.message })),
    ]);

    logInfo('[Referral] rewarded', {
      referralId: referral.id,
      referrerAmount,
      refereeAmount,
      transactionId: transaction.id,
    });

    return { rewarded: true, referralId: referral.id, referrerAmount, refereeAmount };
  } catch (err) {
    logError('[Referral] qualifyAndRewardOnFirstPurchase failed', {
      error: err,
      userId,
      transactionId: transaction?.id,
      stack: err?.stack,
    });
    return { rewarded: false, reason: 'exception', error: err?.message };
  }
}

export async function getMyReferralDashboard(userId) {
  const supabase = getSupabaseAdmin();
  const codeRow = await ensureReferralCode(userId);
  const settings = await getSettings();

  const { data: rows, error } = await supabase
    .from('referrals')
    .select('id, status, referral_code, referrer_reward_kobo, referee_reward_kobo, attributed_at, rewarded_at, referee_id')
    .eq('referrer_id', userId)
    .order('attributed_at', { ascending: false })
    .limit(50);

  if (error) throw new ReferralError(`Failed to list referrals: ${error.message}`, 500);

  const refereeIds = [...new Set((rows || []).map((r) => r.referee_id).filter(Boolean))];
  let nameById = {};
  if (refereeIds.length) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, first_name')
      .in('id', refereeIds);
    nameById = Object.fromEntries((profiles || []).map((p) => [p.id, p.first_name || 'Friend']));
  }

  const list = (rows || []).map((r) => ({
    id: r.id,
    status: r.status,
    referee_first_name: nameById[r.referee_id] || 'Friend',
    referrer_reward_kobo: r.referrer_reward_kobo,
    attributed_at: r.attributed_at,
    rewarded_at: r.rewarded_at,
  }));

  const pending = list.filter((r) => r.status === 'pending' || r.status === 'qualified').length;
  const rewarded = list.filter((r) => r.status === 'rewarded').length;
  const earned_kobo = (rows || [])
    .filter((r) => r.status === 'rewarded')
    .reduce((sum, r) => sum + (Number(r.referrer_reward_kobo) || 0), 0);

  const frontendUrl = (process.env.FRONTEND_URL || 'https://app.motoka.ng').replace(/\/$/, '');

  return {
    code: codeRow.code,
    share_url: `${frontendUrl}/auth/signup?ref=${codeRow.code}`,
    is_active: settings.is_active,
    referrer_reward_kobo: settings.referrer_reward_kobo,
    referee_reward_kobo: settings.referee_reward_kobo,
    stats: { pending, rewarded, earned_kobo, total: list.length },
    referrals: list,
  };
}

export async function listReferralsAdmin({ status, page = 1, limit = 20 } = {}) {
  const supabase = getSupabaseAdmin();
  const from = (page - 1) * limit;
  let query = supabase
    .from('referrals')
    .select(
      'id, referrer_id, referee_id, referral_code, status, referrer_reward_kobo, referee_reward_kobo, qualifying_reference, fraud_notes, attributed_at, qualified_at, rewarded_at',
      { count: 'exact' }
    )
    .order('attributed_at', { ascending: false })
    .range(from, from + limit - 1);

  if (status) query = query.eq('status', status);

  const { data, error, count } = await query;
  if (error) throw new ReferralError(`Failed to list referrals: ${error.message}`, 500);

  const userIds = [
    ...new Set(
      (data || []).flatMap((r) => [r.referrer_id, r.referee_id]).filter(Boolean)
    ),
  ];
  let profileMap = {};
  if (userIds.length) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, first_name, last_name, email')
      .in('id', userIds);
    profileMap = Object.fromEntries(
      (profiles || []).map((p) => [
        p.id,
        {
          name: `${p.first_name || ''} ${p.last_name || ''}`.trim() || p.email,
          email: p.email,
        },
      ])
    );
  }

  const items = (data || []).map((r) => ({
    ...r,
    referrer: profileMap[r.referrer_id] || null,
    referee: profileMap[r.referee_id] || null,
  }));

  return { items, total: count || 0, page, limit };
}
