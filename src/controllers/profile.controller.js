import { getSupabaseAdmin } from '../config/supabase.js';
import * as response from '../utils/responses.js';
import { invalidateProfileCache } from '../middleware/authenticate.js';

/**
 * Auto-renew eligibility: only users with at least one confirmed payment may
 * opt in, so Motoka never fronts government/insurer fees for a stranger.
 * Counts signed-in payments and guest payments linked to this account.
 */
async function hasSuccessfulPayment(supabaseAdmin, userId) {
  const { data: tx } = await supabaseAdmin
    .from('payment_transactions')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'successful')
    .limit(1)
    .maybeSingle();
  if (tx) return true;

  const { data: guest } = await supabaseAdmin
    .from('guest_renewal_orders')
    .select('id')
    .eq('linked_user_id', userId)
    .eq('payment_status', 'payment_success')
    .limit(1)
    .maybeSingle();
  return Boolean(guest);
}

export const getProfile = async (req, res) => {
  try {
    const profile = req.user.profile;
    const supabaseAdmin = getSupabaseAdmin();
    const autoRenewEligible = await hasSuccessfulPayment(supabaseAdmin, req.user.id).catch(() => false);

    return response.success(res, {
      profile: {
        id: req.user.id,
        user_id: profile.user_id,
        email: req.user.email,
        first_name: profile.first_name,
        last_name: profile.last_name,
        phone_number: profile.phone_number,
        image: profile.image,
        nin: profile.nin,
        address: profile.address,
        gender: profile.gender,
        user_type: profile.user_type,
        two_factor_enabled: profile.two_factor_enabled,
        two_factor_type: profile.two_factor_type,
        terms_accepted_at: profile.terms_accepted_at || null,
        auto_renew_enabled: Boolean(profile.auto_renew_enabled),
        auto_renew_eligible: autoRenewEligible,
        created_at: profile.created_at,
        updated_at: profile.updated_at
      }
    });
  } catch (error) {
    console.error('Get profile error:', error);
    return response.serverError(res, 'Failed to retrieve profile');
  }
};

export const updateProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { first_name, last_name, phone_number, image, nin, address, gender } = req.body;
    const supabaseAdmin = getSupabaseAdmin();
    
    const updates = {};
    if (first_name !== undefined) updates.first_name = first_name;
    if (last_name !== undefined) updates.last_name = last_name;
    if (phone_number !== undefined) updates.phone_number = phone_number;
    if (image !== undefined) updates.image = image;
    if (nin !== undefined) updates.nin = nin;
    if (address !== undefined) updates.address = address;
    if (gender !== undefined) updates.gender = gender;
    
    if (Object.keys(updates).length === 0) {
      return response.error(res, 'No fields to update');
    }
    
    if (phone_number) {
      const { data: existing } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('phone_number', phone_number)
        .neq('id', userId)
        .single();
      
      if (existing) {
        return response.error(res, 'Phone number already in use', 409);
      }
    }
    
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .update(updates)
      .eq('id', userId)
      .select()
      .single();
    
    if (error) {
      console.error('Profile update error:', error);
      return response.error(res, 'Failed to update profile');
    }
    
    return response.success(res, {
      profile: {
        id: userId,
        user_id: profile.user_id,
        email: req.user.email,
        first_name: profile.first_name,
        last_name: profile.last_name,
        phone_number: profile.phone_number,
        image: profile.image,
        nin: profile.nin,
        address: profile.address,
        gender: profile.gender,
        user_type: profile.user_type,
        two_factor_enabled: profile.two_factor_enabled,
        two_factor_type: profile.two_factor_type,
        created_at: profile.created_at,
        updated_at: profile.updated_at
      }
    }, 'Profile updated successfully');
  } catch (error) {
    console.error('Update profile error:', error);
    return response.serverError(res, 'Failed to update profile');
  }
};

/**
 * PUT /settings/consents { terms_accepted?: boolean, auto_renew?: boolean }
 *
 * Records post-signup consents (first-login modal, Settings toggle).
 * Enabling auto-renew requires a prior successful payment; switching it off
 * is always allowed.
 */
export const updateConsents = async (req, res) => {
  try {
    const userId = req.user.id;
    const { terms_accepted, auto_renew } = req.body || {};
    const supabaseAdmin = getSupabaseAdmin();

    if (terms_accepted === undefined && auto_renew === undefined) {
      return response.error(res, 'Nothing to update — send terms_accepted and/or auto_renew');
    }

    const updates = { updated_at: new Date().toISOString() };
    if (terms_accepted === true) {
      updates.terms_accepted_at = new Date().toISOString();
    }
    if (auto_renew !== undefined) {
      if (auto_renew === true) {
        const eligible = await hasSuccessfulPayment(supabaseAdmin, userId).catch(() => false);
        if (!eligible) {
          return response.error(res, 'Auto-renew unlocks after your first successful payment', 403);
        }
        updates.auto_renew_enabled = true;
      } else {
        updates.auto_renew_enabled = false;
      }
    }

    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .update(updates)
      .eq('id', userId)
      .select('id, terms_accepted_at, auto_renew_enabled, updated_at')
      .single();

    if (error) {
      console.error('Update consents error:', error);
      return response.error(res, 'Failed to save preferences');
    }

    invalidateProfileCache(userId);

    const autoRenewEligible = await hasSuccessfulPayment(supabaseAdmin, userId).catch(() => false);
    return response.success(res, {
      consents: {
        terms_accepted_at: profile.terms_accepted_at || null,
        auto_renew_enabled: Boolean(profile.auto_renew_enabled),
        auto_renew_eligible: autoRenewEligible,
      },
    }, 'Preferences saved');
  } catch (error) {
    console.error('Update consents error:', error);
    return response.serverError(res, 'Failed to save preferences');
  }
};
