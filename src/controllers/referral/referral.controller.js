import * as response from '../../utils/responses.js';
import { logError } from '../../utils/logger.js';
import * as referralService from '../../services/referral/referral.service.js';

export async function getMyReferral(req, res) {
  try {
    const data = await referralService.getMyReferralDashboard(req.user.id);
    return response.success(res, data, 'Referral dashboard retrieved');
  } catch (err) {
    logError('[Referral] getMyReferral error', err);
    return response.serverError(res, err.message || 'Failed to load referral dashboard');
  }
}

export async function validateCode(req, res) {
  try {
    const result = await referralService.validateReferralCode(req.params.code);
    return response.success(res, result, result.valid ? 'Valid referral code' : 'Invalid referral code');
  } catch (err) {
    logError('[Referral] validateCode error', err);
    return response.serverError(res, 'Failed to validate referral code');
  }
}

export async function getAdminSettings(req, res) {
  try {
    const data = await referralService.getSettings();
    return response.success(res, data, 'Referral settings retrieved');
  } catch (err) {
    logError('[Referral] getAdminSettings error', err);
    return response.serverError(res, 'Failed to load referral settings');
  }
}

export async function updateAdminSettings(req, res) {
  try {
    const {
      referrer_reward_kobo,
      referee_reward_kobo,
      is_active,
      max_rewards_per_referrer,
    } = req.body || {};

    if (
      referrer_reward_kobo === undefined &&
      referee_reward_kobo === undefined &&
      is_active === undefined &&
      max_rewards_per_referrer === undefined
    ) {
      return response.error(
        res,
        'Provide at least one of referrer_reward_kobo, referee_reward_kobo, is_active, max_rewards_per_referrer',
        400
      );
    }

    const parseKobo = (v, field) => {
      if (v === undefined) return undefined;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0) {
        throw new referralService.ReferralError(`${field} must be a non-negative integer (kobo)`, 400);
      }
      return n;
    };

    let referrerRewardKobo;
    let refereeRewardKobo;
    try {
      referrerRewardKobo = parseKobo(referrer_reward_kobo, 'referrer_reward_kobo');
      refereeRewardKobo = parseKobo(referee_reward_kobo, 'referee_reward_kobo');
    } catch (e) {
      return response.error(res, e.message, 400);
    }

    let maxRewards = undefined;
    if (max_rewards_per_referrer !== undefined) {
      if (max_rewards_per_referrer === null || max_rewards_per_referrer === '') {
        maxRewards = null;
      } else {
        const n = Number(max_rewards_per_referrer);
        if (!Number.isInteger(n) || n < 1) {
          return response.error(res, 'max_rewards_per_referrer must be a positive integer or null', 400);
        }
        maxRewards = n;
      }
    }

    const data = await referralService.updateSettings({
      referrerRewardKobo,
      refereeRewardKobo,
      isActive: is_active === undefined ? undefined : Boolean(is_active),
      maxRewardsPerReferrer: maxRewards,
      adminId: req.admin?.id || null,
    });

    return response.success(res, data, 'Referral settings updated');
  } catch (err) {
    logError('[Referral] updateAdminSettings error', err);
    if (err instanceof referralService.ReferralError) {
      return response.error(res, err.message, err.statusCode);
    }
    return response.serverError(res, 'Failed to update referral settings');
  }
}

export async function listAdminReferrals(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const status = req.query.status || null;
    const allowed = new Set(['pending', 'qualified', 'rewarded', 'rejected']);
    if (status && !allowed.has(status)) {
      return response.error(res, 'Invalid status filter', 400);
    }
    const data = await referralService.listReferralsAdmin({ status, page, limit });
    return response.success(res, data, 'Referrals retrieved');
  } catch (err) {
    logError('[Referral] listAdminReferrals error', err);
    return response.serverError(res, 'Failed to list referrals');
  }
}
