import { getSupabaseAdmin } from '../config/supabase.js';
import * as response from '../utils/responses.js';
import paymentMetrics from '../services/payment/metrics.service.js';
import { healthMonitor } from '../services/payment/gateway/health-monitor.js';
import { gatewayManager } from '../services/payment/gateway/gateway-manager.js';
import { invalidateProfileCache } from '../middleware/authenticate.js';

export const listUsers = async (req, res) => {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { page = 1, limit = 20, search, status } = req.query;
    
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    let query = supabaseAdmin
      .from('profiles')
      .select('*', { count: 'exact' })
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1);
    
    if (search) {
      query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,phone_number.ilike.%${search}%,email.ilike.%${search}%`);
    }
    
    if (status === 'suspended') {
      query = query.eq('is_suspended', true);
    } else if (status === 'active') {
      query = query.eq('is_suspended', false);
    } else if (status === 'deleted') {
      query = query.not('deleted_at', 'is', null);
    }
    
    const { data: profiles, count, error } = await query;
    
    if (error) {
      console.error('List users error:', error);
      return res.status(400).json({ status: false, message: 'Failed to retrieve users' });
    }
    
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

    const userIds = profiles.map(p => p.id);
    
    const { data: carCounts } = await supabaseAdmin
      .from('cars')
      .select('user_id')
      .in('user_id', userIds)
      .is('deleted_at', null);
    
    const carsCountMap = new Map();
    if (carCounts) {
      carCounts.forEach(car => {
        carsCountMap.set(car.user_id, (carsCountMap.get(car.user_id) || 0) + 1);
      });
    }
    
    const users = profiles.map(profile => ({
      userId: profile.user_id,
      id: profile.id,
      name: `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || 'N/A',
      email: emailMap.get(profile.id) || null,
      phone: profile.phone_number,
      image: profile.image,
      user_type: profile.user_type || profile.user_type_id,
      is_admin: profile.is_admin,
      is_suspended: profile.is_suspended,
      deleted_at: profile.deleted_at,
      cars_count: carsCountMap.get(profile.id) || 0,
      orders_count: 0,
      created_at: profile.created_at
    }));
    
    return res.status(200).json({
      status: true,
      message: 'Users retrieved successfully',
      data: {
        data: users,
        current_page: parseInt(page),
        per_page: parseInt(limit),
        total: count,
        last_page: Math.ceil(count / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('List users error:', error);
    return res.status(500).json({ status: false, message: 'Failed to retrieve users' });
  }
};

export const getUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const supabaseAdmin = getSupabaseAdmin();
    
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .is('deleted_at', null)
      .single();
    
    if (error || !profile) {
      return res.status(404).json({ status: false, message: 'User not found' });
    }
    
    const { data: { user: authUser } } = await supabaseAdmin.auth.admin.getUserById(userId);
    
    const { data: kyc } = await supabaseAdmin
      .from('kycs')
      .select('*')
      .eq('user_id', userId)
      .single();
    
    // Get user's cars count
    const { count: carsCount } = await supabaseAdmin
      .from('cars')
      .select('id', { count: 'exact' })
      .eq('user_id', userId)
      .is('deleted_at', null);
    
    return res.status(200).json({
      status: true,
      message: 'User retrieved successfully',
      data: {
        user: {
          id: profile.id,
          user_id: profile.user_id,
          email: authUser?.email || null,
          email_verified: !!authUser?.email_confirmed_at,
          first_name: profile.first_name,
          last_name: profile.last_name,
          name: `${profile.first_name || ''} ${profile.last_name || ''}`.trim(),
          phone_number: profile.phone_number,
          image: profile.image,
          nin: profile.nin,
          address: profile.address,
          gender: profile.gender,
          user_type: profile.user_type || profile.user_type_id,
          user_type_id: profile.user_type_id,
          is_admin: profile.is_admin,
          is_suspended: profile.is_suspended,
          two_factor_enabled: profile.two_factor_enabled,
          two_factor_type: profile.two_factor_type,
          kyc_status: kyc?.status || null,
          cars_count: carsCount || 0,
          orders_count: 0,
          created_at: profile.created_at,
          updated_at: profile.updated_at
        }
      }
    });
  } catch (error) {
    console.error('Get user error:', error);
    return res.status(500).json({ status: false, message: 'Failed to retrieve user' });
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
    
    // Invalidate profile cache to ensure suspension takes effect immediately
    invalidateProfileCache(userId);
    
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
    
    // Invalidate profile cache to ensure activation takes effect immediately
    invalidateProfileCache(userId);
    
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

export const deleteUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const supabaseAdmin = getSupabaseAdmin();
    
    const { data: profile, error: fetchError } = await supabaseAdmin
      .from('profiles')
      .select('id, is_admin')
      .eq('id', userId)
      .is('deleted_at', null)
      .single();
    
    if (fetchError || !profile) {
      return res.status(404).json({ status: false, message: 'User not found' });
    }
    
    if (profile.is_admin) {
      return res.status(403).json({ status: false, message: 'Cannot delete an admin user' });
    }
    
    const { error } = await supabaseAdmin
      .from('profiles')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', userId);
    
    if (error) {
      console.error('Delete user error:', error);
      return res.status(500).json({ status: false, message: 'Failed to delete user' });
    }
    
    return res.status(200).json({ 
      status: true, 
      message: 'User deleted successfully',
      data: { user_id: userId }
    });
  } catch (error) {
    console.error('Delete user error:', error);
    return res.status(500).json({ status: false, message: 'Failed to delete user' });
  }
};

export const listCars = async (req, res) => {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { page = 1, per_page = 15, status = 'all' } = req.query;
    
    const limit = parseInt(per_page);
    const offset = (parseInt(page) - 1) * limit;
    
    let query = supabaseAdmin
      .from('cars')
      .select('*', { count: 'exact' })
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    
    if (status !== 'all') {
      query = query.eq('status', status);
    }
    
    const { data: cars, count, error } = await query;
    
    if (error) {
      console.error('List cars error:', error);
      return res.status(400).json({ status: false, message: 'Failed to retrieve cars' });
    }
    
    const userIds = [...new Set(cars.map(car => car.user_id))];
    const profilesMap = new Map();
    const emailMap = new Map();
    
    if (userIds.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from('profiles')
        .select('id, first_name, last_name, user_id')
        .in('id', userIds);
      
      if (profiles) {
        profiles.forEach(profile => {
          profilesMap.set(profile.id, profile);
        });
      }
      
      const userFetches = userIds.map(userId => 
        supabaseAdmin.auth.admin.getUserById(userId)
          .then(({ data }) => ({ id: userId, email: data?.user?.email }))
          .catch(() => ({ id: userId, email: null }))
      );
      
      const userResults = await Promise.all(userFetches);
      userResults.forEach(result => {
        if (result.email) emailMap.set(result.id, result.email);
      });
    }
    
    const formattedCars = cars.map(car => {
      const profile = profilesMap.get(car.user_id);
      return {
        id: car.id,
        slug: car.slug,
        vehicle_make: car.vehicle_make,
        vehicle_model: car.vehicle_model,
        vehicle_year: car.vehicle_year,
        vehicle_color: car.vehicle_color,
        registration_no: car.registration_no,
        chasis_no: car.chasis_no,
        engine_no: car.engine_no,
        car_type: car.car_type,
        status: car.status,
        expiry_date: car.expiry_date,
        name_of_owner: car.name_of_owner,
        user: profile ? {
          id: profile.id,
          name: `${profile.first_name || ''} ${profile.last_name || ''}`.trim(),
          email: emailMap.get(car.user_id) || null,
          user_id: profile.user_id
        } : null,
        created_at: car.created_at
      };
    });
    
    return res.status(200).json({
      status: true,
      message: 'Cars retrieved successfully',
      data: {
        data: formattedCars,
        current_page: parseInt(page),
        per_page: limit,
        total: count,
        last_page: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    console.error('List cars error:', error);
    return res.status(500).json({ status: false, message: 'Failed to retrieve cars' });
  }
};

export const getCarDetails = async (req, res) => {
  try {
    const { slug } = req.params;
    const supabaseAdmin = getSupabaseAdmin();
    
    const { data: car, error } = await supabaseAdmin
      .from('cars')
      .select('*')
      .eq('slug', slug)
      .is('deleted_at', null)
      .single();
    
    if (error || !car) {
      return res.status(404).json({ status: false, message: 'Car not found' });
    }
    
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id, first_name, last_name, phone_number, user_id')
      .eq('id', car.user_id)
      .single();
    
    let userEmail = null;
    try {
      const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(car.user_id);
      userEmail = authUser?.user?.email;
    } catch (err) {
      console.error('Failed to fetch user email:', err);
    }
    
    const formattedCar = {
      ...car,
      user: profile ? {
        ...profile,
        email: userEmail,
        name: `${profile.first_name || ''} ${profile.last_name || ''}`.trim()
      } : null
    };
    
    return res.status(200).json({
      status: true,
      message: 'Car retrieved successfully',
      data: formattedCar
    });
  } catch (error) {
    console.error('Get car details error:', error);
    return res.status(500).json({ status: false, message: 'Failed to retrieve car' });
  }
};

export const getPaymentMetrics = async (req, res) => {
  try {
    const snapshot = paymentMetrics.getSnapshot();
    
    return res.status(200).json({
      status: true,
      message: 'Payment metrics retrieved successfully',
      data: snapshot
    });
  } catch (error) {
    console.error('Get payment metrics error:', error);
    return res.status(500).json({ 
      status: false, 
      message: 'Failed to retrieve payment metrics' 
    });
  }
};

export const getGatewayHealth = async (req, res) => {
  try {
    const healthData = healthMonitor.getAllGatewayHealth();
    const circuitBreakerStatus = gatewayManager.getCircuitBreakerStatus();
    const statistics = gatewayManager.getStatistics();

    const gatewayStatus = {};
    Object.keys(healthData).forEach(gatewayName => {
      gatewayStatus[gatewayName] = {
        ...healthData[gatewayName],
        circuitBreaker: circuitBreakerStatus[gatewayName] || null,
        available: gatewayManager.isGatewayAvailable(gatewayName)
      };
    });

    return res.status(200).json({
      status: true,
      message: 'Gateway health status retrieved successfully',
      data: {
        gateways: gatewayStatus,
        primary: gatewayManager.getPrimaryGateway(),
        fallback: gatewayManager.getFallbackGateway(),
        statistics: {
          circuitBreakers: circuitBreakerStatus,
          healthMonitor: {
            isRunning: healthMonitor.isRunning,
            checkIntervalMs: healthMonitor.checkIntervalMs
          }
        }
      }
    });
  } catch (error) {
    console.error('Get gateway health error:', error);
    return res.status(500).json({ 
      status: false, 
      message: 'Failed to retrieve gateway health status',
      error: error.message 
    });
  }
};
