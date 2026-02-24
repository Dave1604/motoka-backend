import { getSupabaseAdmin } from '../config/supabase.js';
import * as response from '../utils/responses.js';
import paymentMetrics from '../services/payment/metrics.service.js';
import { healthMonitor } from '../services/payment/gateway/health-monitor.js';
import { gatewayManager } from '../services/payment/gateway/gateway-manager.js';
import { invalidateProfileCache } from '../middleware/authenticate.js';

// Paystack stores all amounts in kobo (100 kobo = ₦1). Convert before returning to frontend.
const koboToNaira = (kobo) => Math.round(parseFloat(kobo || 0)) / 100;

// ─── Status normalization helpers ────────────────────────────────────────────
// DB stores: pending | processing | completed | cancelled
// Frontend expects: pending (New) | in_progress (Inprogress) | completed | declined

function dbStatusToFrontend(status) {
  if (status === 'processing') return 'in_progress';
  if (status === 'cancelled') return 'declined';
  return status;
}

function frontendStatusToDB(status) {
  if (status === 'in_progress') return 'processing';
  if (status === 'declined') return 'cancelled';
  return status;
}

// Format an order row into the shape the frontend expects
function formatOrder(order, profile, userEmail, stateName, lgaName) {
  return {
    id: order.id,
    slug: order.order_number,          // frontend navigates by this field
    order_number: order.order_number,
    order_type: order.order_type,
    amount: koboToNaira(order.amount_paid),
    amount_paid: koboToNaira(order.amount_paid),
    renewal_months: order.renewal_months,
    status: dbStatusToFrontend(order.status),
    delivery_address: order.delivery_address,
    delivery_contact: order.delivery_contact,
    delivery_state: order.delivery_state,
    delivery_lga: order.delivery_lga,
    state_name: stateName || order.delivery_state,
    lga_name: lgaName || order.delivery_lga,
    selected_items: order.selected_items,
    previous_expiry_date: order.previous_expiry_date,
    new_expiry_date: order.new_expiry_date,
    processing_notes: order.processing_notes,
    completion_notes: order.completion_notes,
    rejection_reason: order.rejection_reason,
    documents_uploaded: order.documents_uploaded,
    documents_sent_at: order.documents_sent_at || null,
    assigned_to: order.assigned_to,
    assigned_at: order.assigned_at,
    processing_started_at: order.processing_started_at,
    completed_at: order.completed_at,
    cancelled_at: order.cancelled_at,
    created_at: order.created_at,
    updated_at: order.updated_at,
    user: profile ? {
      id: profile.id,
      name: `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || 'Unknown',
      first_name: profile.first_name,
      last_name: profile.last_name,
      email: userEmail || null,
      phone_number: profile.phone_number,
    } : null,
    car: order.cars ? {
      id: order.cars.id,
      slug: order.cars.slug,
      vehicle_make: order.cars.vehicle_make,
      vehicle_model: order.cars.vehicle_model,
      vehicle_year: order.cars.vehicle_year,
      vehicle_color: order.cars.vehicle_color,
      registration_no: order.cars.registration_no,
      chasis_no: order.cars.chasis_no,
      engine_no: order.cars.engine_no,
      expiry_date: order.cars.expiry_date,
    } : null,
    payment: order.payment_transactions ? {
      transaction_id: order.payment_transactions.reference,
      payment_gateway: 'paystack',
      status: order.payment_transactions.status,
      amount: koboToNaira(order.payment_transactions.amount),
      paid_at: order.payment_transactions.paid_at,
    } : null,
  };
}

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

// ─── Helper: resolve state/LGA names for a batch of orders ───────────────────
async function enrichOrdersWithLocation(supabaseAdmin, orders) {
  const stateCodes = [...new Set(orders.map(o => o.delivery_state).filter(Boolean))];
  const stateMap = new Map();
  const lgaMap = new Map();

  if (stateCodes.length > 0) {
    const { data: states } = await supabaseAdmin
      .from('states')
      .select('code, name')
      .in('code', stateCodes);

    (states || []).forEach(s => stateMap.set(s.code, s.name));

    // Fetch LGAs for matched states
    const stateIds = (states || []).map(s => s.id).filter(Boolean);
    if (stateIds.length > 0) {
      const { data: lgas } = await supabaseAdmin
        .from('local_governments')
        .select('id, name, state_id')
        .in('state_id', stateIds);

      (lgas || []).forEach(l => lgaMap.set(`${l.state_id}:${l.name}`, l.name));
    }
  }

  return { stateMap, lgaMap };
}

// ─── Helper: fetch user profiles + emails for a list of user UUIDs ───────────
async function fetchUserDetails(supabaseAdmin, userIds) {
  const profileMap = new Map();
  const emailMap = new Map();

  if (userIds.length === 0) return { profileMap, emailMap };

  const { data: profiles } = await supabaseAdmin
    .from('profiles')
    .select('id, first_name, last_name, phone_number')
    .in('id', userIds);

  (profiles || []).forEach(p => profileMap.set(p.id, p));

  const emailFetches = userIds.map(uid =>
    supabaseAdmin.auth.admin.getUserById(uid)
      .then(({ data }) => ({ id: uid, email: data?.user?.email }))
      .catch(() => ({ id: uid, email: null }))
  );
  const emailResults = await Promise.all(emailFetches);
  emailResults.forEach(r => { if (r.email) emailMap.set(r.id, r.email); });

  return { profileMap, emailMap };
}

// ─── Dashboard Stats ──────────────────────────────────────────────────────────
export const getDashboardStats = async (req, res) => {
  try {
    const supabaseAdmin = getSupabaseAdmin();

    const [
      { count: totalOrders },
      { count: totalCars },
      { count: totalUsers },
      { data: amountData },
    ] = await Promise.all([
      supabaseAdmin.from('renewal_orders').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('cars').select('id', { count: 'exact', head: true }).is('deleted_at', null),
      supabaseAdmin.from('profiles').select('id', { count: 'exact', head: true }).is('deleted_at', null).eq('is_admin', false),
      supabaseAdmin.from('payment_transactions').select('amount').eq('status', 'successful'),
    ]);

    const totalAmountKobo = (amountData || []).reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);

    return res.status(200).json({
      status: true,
      message: 'Dashboard stats retrieved',
      data: {
        total_amount: koboToNaira(totalAmountKobo),
        total_orders: totalOrders || 0,
        total_agents: 0,
        total_cars: totalCars || 0,
        total_users: totalUsers || 0,
      },
    });
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    return res.status(500).json({ status: false, message: 'Failed to retrieve dashboard stats' });
  }
};

// ─── Recent Orders (last 5) ───────────────────────────────────────────────────
export const getRecentOrders = async (req, res) => {
  try {
    const supabaseAdmin = getSupabaseAdmin();

    const { data: orders, error } = await supabaseAdmin
      .from('renewal_orders')
      .select(`
        id, order_number, order_type, amount_paid, status, user_id, created_at,
        cars:car_id ( id, slug, vehicle_make, vehicle_model, registration_no ),
        payment_transactions:transaction_id ( id, reference, amount, status, paid_at )
      `)
      .order('created_at', { ascending: false })
      .limit(5);

    if (error) return res.status(500).json({ status: false, message: 'Failed to retrieve recent orders' });

    const userIds = [...new Set((orders || []).map(o => o.user_id))];
    const { profileMap, emailMap } = await fetchUserDetails(supabaseAdmin, userIds);

    const formatted = (orders || []).map(o =>
      formatOrder(o, profileMap.get(o.user_id), emailMap.get(o.user_id), null, null)
    );

    return res.status(200).json({ status: true, message: 'Recent orders retrieved', data: formatted });
  } catch (error) {
    console.error('Get recent orders error:', error);
    return res.status(500).json({ status: false, message: 'Failed to retrieve recent orders' });
  }
};

// ─── Recent Transactions (last 5) ────────────────────────────────────────────
export const getRecentTransactions = async (req, res) => {
  try {
    const supabaseAdmin = getSupabaseAdmin();

    const { data: transactions, error } = await supabaseAdmin
      .from('payment_transactions')
      .select('id, reference, amount, status, payment_type, user_id, created_at, paid_at')
      .order('created_at', { ascending: false })
      .limit(5);

    if (error) return res.status(500).json({ status: false, message: 'Failed to retrieve recent transactions' });

    const userIds = [...new Set((transactions || []).map(t => t.user_id))];
    const { profileMap, emailMap } = await fetchUserDetails(supabaseAdmin, userIds);

    const formatted = (transactions || []).map(t => ({
      id: t.id,
      transaction_id: t.reference,
      gateway_reference: t.reference,
      amount: koboToNaira(t.amount),
      status: t.status,
      payment_type: t.payment_type,
      payment_description: t.payment_type?.replace(/_/g, ' '),
      created_at: t.created_at,
      paid_at: t.paid_at,
      user: profileMap.get(t.user_id) ? {
        name: `${profileMap.get(t.user_id).first_name || ''} ${profileMap.get(t.user_id).last_name || ''}`.trim(),
        email: emailMap.get(t.user_id) || null,
      } : null,
    }));

    return res.status(200).json({ status: true, message: 'Recent transactions retrieved', data: formatted });
  } catch (error) {
    console.error('Get recent transactions error:', error);
    return res.status(500).json({ status: false, message: 'Failed to retrieve recent transactions' });
  }
};

// ─── List Orders (paginated, filterable) ─────────────────────────────────────
export const listOrders = async (req, res) => {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { page = 1, per_page = 15, status = 'all', search } = req.query;

    const limit = Math.min(100, Math.max(1, parseInt(per_page)));
    const offset = (Math.max(1, parseInt(page)) - 1) * limit;

    let query = supabaseAdmin
      .from('renewal_orders')
      .select(`
        id, order_number, order_type, amount_paid, status, user_id,
        delivery_address, delivery_state, delivery_lga, delivery_contact,
        created_at, updated_at,
        cars:car_id ( id, slug, vehicle_make, vehicle_model, registration_no ),
        payment_transactions:transaction_id ( id, reference, amount, status )
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // Map frontend filter values to DB status values
    if (status && status !== 'all') {
      query = query.eq('status', frontendStatusToDB(status));
    }

    const { data: orders, count, error } = await query;
    if (error) {
      console.error('List orders error:', error);
      return res.status(500).json({ status: false, message: 'Failed to retrieve orders' });
    }

    const userIds = [...new Set((orders || []).map(o => o.user_id))];
    const { profileMap, emailMap } = await fetchUserDetails(supabaseAdmin, userIds);

    // Resolve state names
    const stateCodes = [...new Set((orders || []).map(o => o.delivery_state).filter(Boolean))];
    const stateNameMap = new Map();
    if (stateCodes.length > 0) {
      const { data: states } = await supabaseAdmin
        .from('states')
        .select('code, name')
        .in('code', stateCodes);
      (states || []).forEach(s => stateNameMap.set(s.code, s.name));
    }

    let formatted = (orders || []).map(o =>
      formatOrder(
        o,
        profileMap.get(o.user_id),
        emailMap.get(o.user_id),
        stateNameMap.get(o.delivery_state),
        o.delivery_lga
      )
    );

    // Client-side search filter (by user name or order number)
    if (search) {
      const q = search.toLowerCase();
      formatted = formatted.filter(o =>
        o.user?.name?.toLowerCase().includes(q) ||
        o.order_number?.toLowerCase().includes(q)
      );
    }

    const total = count || 0;
    return res.status(200).json({
      status: true,
      message: 'Orders retrieved successfully',
      data: {
        data: formatted,
        current_page: parseInt(page),
        per_page: limit,
        total,
        last_page: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('List orders error:', error);
    return response.serverError(res, 'Failed to retrieve orders');
  }
};

// ─── Get Single Order Details ─────────────────────────────────────────────────
export const getOrderDetails = async (req, res) => {
  try {
    const { orderNumber } = req.params;
    const supabaseAdmin = getSupabaseAdmin();

    const { data: order, error } = await supabaseAdmin
      .from('renewal_orders')
      .select(`
        *,
        cars:car_id ( id, slug, vehicle_make, vehicle_model, vehicle_year, vehicle_color,
                      registration_no, chasis_no, engine_no, expiry_date ),
        payment_transactions:transaction_id ( id, reference, amount, status, paid_at, channel )
      `)
      .eq('order_number', orderNumber)
      .single();

    if (error || !order) {
      return res.status(404).json({ status: false, message: 'Order not found' });
    }

    // Fetch user profile + email
    const { profileMap, emailMap } = await fetchUserDetails(supabaseAdmin, [order.user_id]);

    // Resolve state name
    let stateName = order.delivery_state;
    if (order.delivery_state) {
      const { data: stateRow } = await supabaseAdmin
        .from('states')
        .select('name')
        .eq('code', order.delivery_state)
        .single();
      if (stateRow) stateName = stateRow.name;
    }

    const formatted = formatOrder(
      order,
      profileMap.get(order.user_id),
      emailMap.get(order.user_id),
      stateName,
      order.delivery_lga
    );

    return res.status(200).json({ status: true, message: 'Order retrieved successfully', data: formatted });
  } catch (error) {
    console.error('Get order details error:', error);
    return res.status(500).json({ status: false, message: 'Failed to retrieve order' });
  }
};

// ─── Update Order Status ──────────────────────────────────────────────────────
export const updateOrderStatus = async (req, res) => {
  try {
    const { orderNumber } = req.params;
    const { status, notes } = req.body;
    const supabaseAdmin = getSupabaseAdmin();

    if (!status) {
      return res.status(400).json({ status: false, message: 'Status is required' });
    }

    const dbStatus = frontendStatusToDB(status);
    const validStatuses = ['pending', 'processing', 'completed', 'cancelled'];
    if (!validStatuses.includes(dbStatus)) {
      return res.status(400).json({ status: false, message: 'Invalid status. Must be one of: pending, in_progress, completed, declined' });
    }

    // Fetch current order
    const { data: current, error: fetchError } = await supabaseAdmin
      .from('renewal_orders')
      .select('id, status, car_id, renewal_months, cars:car_id(expiry_date)')
      .eq('order_number', orderNumber)
      .single();

    if (fetchError || !current) {
      return res.status(404).json({ status: false, message: 'Order not found' });
    }

    if (current.status === 'completed') {
      return res.status(409).json({ status: false, message: 'Cannot update a completed order' });
    }

    const updateData = {
      status: dbStatus,
      updated_at: new Date().toISOString(),
    };

    if (dbStatus === 'processing' && current.status === 'pending') {
      updateData.processing_started_at = new Date().toISOString();
      // Auto-assign to the admin performing the action
      updateData.assigned_to = req.admin?.id || null;
      updateData.assigned_at = new Date().toISOString();
    }

    if (dbStatus === 'completed') {
      updateData.completed_at = new Date().toISOString();
      // Extend the car's expiry date
      const renewalMonths = current.renewal_months || 12;
      const baseDate = current.cars?.expiry_date
        ? new Date(current.cars.expiry_date)
        : new Date();
      baseDate.setMonth(baseDate.getMonth() + renewalMonths);
      const newExpiry = baseDate.toISOString().split('T')[0];
      updateData.new_expiry_date = newExpiry;
      updateData.completion_notes = notes || null;

      await supabaseAdmin
        .from('cars')
        .update({ expiry_date: newExpiry, date_issued: new Date().toISOString().split('T')[0], status: 'approved' })
        .eq('id', current.car_id);
    }

    if (dbStatus === 'cancelled') {
      updateData.cancelled_at = new Date().toISOString();
      updateData.rejection_reason = notes || null;
    }

    if (notes && dbStatus !== 'cancelled') {
      updateData.processing_notes = notes;
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('renewal_orders')
      .update(updateData)
      .eq('order_number', orderNumber)
      .select(`
        *,
        cars:car_id ( id, slug, vehicle_make, vehicle_model, vehicle_year, vehicle_color,
                      registration_no, chasis_no, engine_no, expiry_date ),
        payment_transactions:transaction_id ( id, reference, amount, status, paid_at )
      `)
      .single();

    if (updateError) {
      console.error('Update order status error:', updateError);
      return response.serverError(res, 'Failed to update order status');
    }

    const { profileMap, emailMap } = await fetchUserDetails(supabaseAdmin, [updated.user_id]);
    const formatted = formatOrder(updated, profileMap.get(updated.user_id), emailMap.get(updated.user_id), null, updated.delivery_lga);

    return res.status(200).json({ status: true, message: 'Order status updated successfully', data: formatted });
  } catch (error) {
    console.error('Update order status error:', error);
    return res.status(500).json({ status: false, message: 'Failed to update order status' });
  }
};

// ─── List Transactions (paginated, filterable) ────────────────────────────────
export const listTransactions = async (req, res) => {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { page = 1, per_page = 15, status = 'all', search } = req.query;

    const limit = Math.min(100, Math.max(1, parseInt(per_page)));
    const offset = (Math.max(1, parseInt(page)) - 1) * limit;

    // Map frontend filter 'success' → DB 'successful'
    const dbStatus = status === 'success' ? 'successful'
      : status === 'failed' ? 'failed'
      : status === 'pending' ? 'pending'
      : null;

    let query = supabaseAdmin
      .from('payment_transactions')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (dbStatus) {
      query = query.eq('status', dbStatus);
    }

    const { data: transactions, count, error } = await query;
    if (error) {
      console.error('List transactions error:', error);
      return res.status(500).json({ status: false, message: 'Failed to retrieve transactions' });
    }

    const userIds = [...new Set((transactions || []).map(t => t.user_id).filter(Boolean))];
    const { profileMap, emailMap } = await fetchUserDetails(supabaseAdmin, userIds);

    // Summary stats across all transactions (not just this page)
    const { data: allTx } = await supabaseAdmin
      .from('payment_transactions')
      .select('amount, status');

    const summary = {
      total_amount: 0,
      total_transactions: count || 0,
      successful_transactions: 0,
      failed_transactions: 0,
      pending_transactions: 0,
    };
    (allTx || []).forEach(t => {
      const amtKobo = parseFloat(t.amount || 0);
      if (t.status === 'successful') { summary.successful_transactions++; summary.total_amount += amtKobo; }
      else if (t.status === 'failed' || t.status === 'abandoned') summary.failed_transactions++;
      else if (t.status === 'pending') summary.pending_transactions++;
    });
    summary.total_amount = koboToNaira(summary.total_amount);

    let formatted = (transactions || []).map(t => {
      const profile = profileMap.get(t.user_id);
      return {
        id: t.id,
        transaction_id: t.reference,
        gateway_reference: t.paystack_reference || t.reference,
        amount: koboToNaira(t.amount),
        status: t.status === 'successful' ? 'approved' : t.status,
        payment_type: t.payment_type,
        payment_description: t.payment_type?.replace(/_/g, ' '),
        channel: t.channel,
        created_at: t.created_at,
        paid_at: t.paid_at,
        user: profile ? {
          name: `${profile.first_name || ''} ${profile.last_name || ''}`.trim(),
          email: emailMap.get(t.user_id) || null,
        } : null,
      };
    });

    // Apply search filter
    if (search) {
      const q = search.toLowerCase();
      formatted = formatted.filter(t =>
        t.transaction_id?.toLowerCase().includes(q) ||
        t.user?.name?.toLowerCase().includes(q) ||
        t.user?.email?.toLowerCase().includes(q)
      );
    }

    const total = count || 0;
    return res.status(200).json({
      status: true,
      message: 'Transactions retrieved successfully',
      data: {
        data: formatted,
        current_page: parseInt(page),
        per_page: limit,
        total,
        last_page: Math.ceil(total / limit),
      },
      summary,
    });
  } catch (error) {
    console.error('List transactions error:', error);
    return response.serverError(res, 'Failed to retrieve transactions');
  }
};

// ─── Failed Transactions (top N) ─────────────────────────────────────────────
export const getFailedTransactions = async (req, res) => {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { per_page = 8 } = req.query;
    const limit = Math.min(50, Math.max(1, parseInt(per_page)));

    const { data: transactions, error } = await supabaseAdmin
      .from('payment_transactions')
      .select('id, reference, amount, status, payment_type, user_id, created_at')
      .in('status', ['failed', 'abandoned'])
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) return res.status(500).json({ status: false, message: 'Failed to retrieve failed transactions' });

    const formatted = (transactions || []).map(t => ({
      id: t.id,
      transaction_id: t.reference,
      amount: koboToNaira(t.amount),
      status: t.status,
      payment_description: t.payment_type?.replace(/_/g, ' ') || 'Transaction',
      created_at: t.created_at,
    }));

    return res.status(200).json({
      status: true,
      message: 'Failed transactions retrieved',
      data: { data: formatted },
    });
  } catch (error) {
    console.error('Get failed transactions error:', error);
    return response.serverError(res, 'Failed to retrieve failed transactions');
  }
};
