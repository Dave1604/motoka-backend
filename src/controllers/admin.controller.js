import { getSupabaseAdmin } from '../config/supabase.js';
import * as response from '../utils/responses.js';

export const listUsers = async (req, res) => {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { page = 1, limit = 20, search, status } = req.query;
    
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    let query = supabaseAdmin
      .from('profiles')
      .select('*, user_types(name)', { count: 'exact' })
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1);
    
    if (search) {
      query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,phone_number.ilike.%${search}%`);
    }
    
    if (status === 'suspended') {
      query = query.eq('is_suspended', true);
    } else if (status === 'active') {
      query = query.eq('is_suspended', false);
    }
    
    const { data: profiles, count, error } = await query;
    
    if (error) {
      console.error('List users error:', error);
      return response.error(res, 'Failed to retrieve users');
    }
    
    // SCALABILITY FIX: Batch fetch only the auth users for paginated profiles
    // instead of loading ALL users into memory
    const emailMap = new Map();
    
    if (profiles && profiles.length > 0) {
      const userFetches = profiles.map(profile => 
        supabaseAdmin.auth.admin.getUserById(profile.id)
          .then(({ data }) => ({ id: profile.id, email: data?.user?.email }))
          .catch(() => ({ id: profile.id, email: null }))
      );
      
      const userResults = await Promise.all(userFetches);
      userResults.forEach(result => {
        if (result.email) emailMap.set(result.id, result.email);
      });
    }
    
    const users = profiles.map(profile => ({
      id: profile.id,
      user_id: profile.user_id,
      email: emailMap.get(profile.id) || null,
      first_name: profile.first_name,
      last_name: profile.last_name,
      phone_number: profile.phone_number,
      image: profile.image,
      user_type: profile.user_types?.name || profile.user_type,
      is_admin: profile.is_admin,
      is_suspended: profile.is_suspended,
      two_factor_enabled: profile.two_factor_enabled,
      created_at: profile.created_at
    }));
    
    return response.success(res, {
      users,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(count / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('List users error:', error);
    return response.serverError(res, 'Failed to retrieve users');
  }
};

export const getUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const supabaseAdmin = getSupabaseAdmin();
    
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('*, user_types(name)')
      .eq('id', userId)
      .is('deleted_at', null)
      .single();
    
    if (error || !profile) {
      return response.notFound(res, 'User not found');
    }
    
    const { data: { user: authUser } } = await supabaseAdmin.auth.admin.getUserById(userId);
    
    const { data: kyc } = await supabaseAdmin
      .from('kycs')
      .select('*')
      .eq('user_id', userId)
      .single();
    
    return response.success(res, {
      user: {
        id: profile.id,
        user_id: profile.user_id,
        email: authUser?.email || null,
        email_verified: !!authUser?.email_confirmed_at,
        first_name: profile.first_name,
        last_name: profile.last_name,
        phone_number: profile.phone_number,
        image: profile.image,
        nin: profile.nin,
        address: profile.address,
        gender: profile.gender,
        user_type: profile.user_types?.name || profile.user_type,
        user_type_id: profile.user_type_id,
        is_admin: profile.is_admin,
        is_suspended: profile.is_suspended,
        two_factor_enabled: profile.two_factor_enabled,
        two_factor_type: profile.two_factor_type,
        kyc_status: kyc?.status || null,
        created_at: profile.created_at,
        updated_at: profile.updated_at
      }
    });
  } catch (error) {
    console.error('Get user error:', error);
    return response.serverError(res, 'Failed to retrieve user');
  }
};

export const suspendUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason } = req.body;
    const supabaseAdmin = getSupabaseAdmin();
    
    if (userId === req.user.id) {
      return response.error(res, 'Cannot suspend your own account');
    }
    
    const { data: profile, error: fetchError } = await supabaseAdmin
      .from('profiles')
      .select('id, is_suspended, is_admin')
      .eq('id', userId)
      .is('deleted_at', null)
      .single();
    
    if (fetchError || !profile) {
      return response.notFound(res, 'User not found');
    }
    
    if (profile.is_admin) {
      return response.forbidden(res, 'Cannot suspend an admin user');
    }
    
    if (profile.is_suspended) {
      return response.error(res, 'User is already suspended');
    }
    
    const { error } = await supabaseAdmin
      .from('profiles')
      .update({ is_suspended: true })
      .eq('id', userId);
    
    if (error) {
      console.error('Suspend user error:', error);
      return response.error(res, 'Failed to suspend user');
    }
    
    await supabaseAdmin.from('notifications').insert({
      user_id: userId,
      title: 'Account Suspended',
      message: reason || 'Your account has been suspended by an administrator.',
      type: 'account'
    });
    
    return response.success(res, { user_id: userId, is_suspended: true }, 'User suspended successfully');
  } catch (error) {
    console.error('Suspend user error:', error);
    return response.serverError(res, 'Failed to suspend user');
  }
};

export const activateUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const supabaseAdmin = getSupabaseAdmin();
    
    const { data: profile, error: fetchError } = await supabaseAdmin
      .from('profiles')
      .select('id, is_suspended')
      .eq('id', userId)
      .is('deleted_at', null)
      .single();
    
    if (fetchError || !profile) {
      return response.notFound(res, 'User not found');
    }
    
    if (!profile.is_suspended) {
      return response.error(res, 'User is not suspended');
    }
    
    const { error } = await supabaseAdmin
      .from('profiles')
      .update({ is_suspended: false })
      .eq('id', userId);
    
    if (error) {
      console.error('Activate user error:', error);
      return response.error(res, 'Failed to activate user');
    }
    
    await supabaseAdmin.from('notifications').insert({
      user_id: userId,
      title: 'Account Activated',
      message: 'Your account has been reactivated. You can now access all features.',
      type: 'account'
    });
    
    return response.success(res, { user_id: userId, is_suspended: false }, 'User activated successfully');
  } catch (error) {
    console.error('Activate user error:', error);
    return response.serverError(res, 'Failed to activate user');
  }
};
