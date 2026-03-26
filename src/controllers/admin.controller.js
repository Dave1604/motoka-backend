import { getSupabaseAdmin } from '../config/supabase.js';
import * as response from '../utils/responses.js';
import paymentMetrics from '../services/payment/metrics.service.js';
import {
  adminListDocuments,
  getDocumentById,
  createDocument,
  updateDocumentStatus
} from '../services/document.service.js';
import { uploadFile } from '../services/fileUpload.service.js';
import { healthMonitor } from '../services/payment/gateway/health-monitor.js';
import { gatewayManager } from '../services/payment/gateway/gateway-manager.js';
import { invalidateProfileCache } from '../middleware/authenticate.js';
import { sendOrderCompletedEmail, sendOrderInProgressEmail } from '../services/email/paymentEmail.service.js';
import { createInAppNotification } from '../services/notification.service.js';
import { logError, logInfo } from '../utils/logger.js';
import {
  sendOrderUpdateWhatsApp,
  sendDocumentReadyWhatsApp,
  sendAddCarReminderWhatsApp,
} from '../services/whatsapp/whatsapp.service.js';
import {
  getTransactionByReference,
  updateTransactionStatus,
  processPaymentSuccess,
} from '../services/payment/transaction.service.js';
import { getOrderById } from '../services/payment/order.service.js';
import { PaymentSuccessService } from '../services/payment/payment-success.service.js';
import { PAYMENT_STATUS, ORDER_TYPE } from '../constants/payment.constants.js';
import { generateOrderNumber } from '../utils/paymentHelpers.js';

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
  if (status === 'new') return 'pending'; // safety net — frontend may send 'new'
  return status;
}

// Format an order row into the shape the frontend expects
function formatOrder(order, profile, userEmail, stateName, lgaName) {
  // Extract plate/license details from transaction metadata for non-renewal orders
  const txMeta = (() => {
    try {
      const raw = order.payment_transactions?.metadata;
      return raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {};
    } catch { return {}; }
  })();

  return {
    id: order.id,
    slug: order.order_number,          // frontend navigates by this field
    order_number: order.order_number,
    order_type: order.order_type,
    payment_type: order.payment_transactions?.payment_type || order.order_type,
    // Plate number specific details (visible for plate_number orders)
    plate_type: txMeta.plateType || null,
    plate_sub_type: txMeta.subType || null,
    // Driver license specific details
    license_type: txMeta.licenseType || null,
    license_duration: txMeta.licenseDuration || null,
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
      preferred_name: order.cars.preferred_name || null,
      plate_type: order.cars.type || null,
    } : null,
    payment: order.payment_transactions ? {
      transaction_id: order.payment_transactions.reference,
      payment_gateway: order.payment_transactions.payment_gateway || 'paystack',
      status: order.payment_transactions.status,
      amount: koboToNaira(order.payment_transactions.amount),
      paid_at: order.payment_transactions.paid_at,
    } : null,
  };
}

export const listUsers = async (req, res) => {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { page = 1, limit = 20, search, status, sort = 'recently_added' } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    // sort: recently_added (default) | a_z (by first_name asc)
    const sortAscending = sort === 'a_z';
    const sortColumn = sort === 'a_z' ? 'first_name' : 'created_at';

    let query = supabaseAdmin
      .from('profiles')
      .select('*', { count: 'exact' })
      .is('deleted_at', null)
      .order(sortColumn, { ascending: sortAscending })
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
      logError('List users', error);
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
    logError('List users', error);
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
    
    // Get user's cars (recent 5) + count
    const { data: carsData, count: carsCount } = await supabaseAdmin
      .from('cars')
      .select('id, vehicle_make, vehicle_model, registration_no, plate_number, status, expiry_date, slug', { count: 'exact' })
      .eq('user_id', userId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(5);

    // Get user's orders (recent 5) + count
    const { data: ordersData, count: ordersCount } = await supabaseAdmin
      .from('renewal_orders')
      .select('id, order_number, order_type, status, amount_paid, created_at', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(5);

    // Get total spent from successful transactions
    const { data: txData } = await supabaseAdmin
      .from('payment_transactions')
      .select('amount')
      .eq('user_id', userId)
      .eq('status', 'successful');
    const totalSpent = (txData || []).reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);

    const recentCars = (carsData || []).map(c => ({
      id: c.id,
      slug: c.slug,
      vehicle_make: c.vehicle_make,
      vehicle_model: c.vehicle_model,
      registration_no: c.registration_no || c.plate_number,
      status: c.status,
      expiry_date: c.expiry_date,
    }));

    const recentOrders = (ordersData || []).map(o => ({
      id: o.id,
      slug: o.order_number,
      order_type: o.order_type,
      status: dbStatusToFrontend(o.status),
      amount: koboToNaira(o.amount_paid),
      created_at: o.created_at,
    }));

    return res.status(200).json({
      status: true,
      message: 'User retrieved successfully',
      data: {
        user: {
          id: profile.id,
          userId: profile.user_id,
          user_id: profile.user_id,
          email: authUser?.email || null,
          email_verified_at: authUser?.email_confirmed_at || null,
          first_name: profile.first_name,
          last_name: profile.last_name,
          name: `${profile.first_name || ''} ${profile.last_name || ''}`.trim(),
          phone: profile.phone_number,
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
          orders_count: ordersCount || 0,
          cars: recentCars,
          orders: recentOrders,
          created_at: profile.created_at,
          updated_at: profile.updated_at
        },
        stats: {
          total_cars: carsCount || 0,
          total_orders: ordersCount || 0,
          pending_orders: (ordersData || []).filter(o => o.status === 'pending').length,
          total_spent: totalSpent,
          last_activity: profile.updated_at,
        }
      }
    });
  } catch (error) {
    logError('Get user', error);
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
      logError('Suspend user', error);
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
    logError('Suspend user', error);
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
      logError('Activate user', error);
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
    logError('Activate user', error);
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
      logError('Delete user', error);
      return res.status(500).json({ status: false, message: 'Failed to delete user' });
    }
    
    return res.status(200).json({ 
      status: true, 
      message: 'User deleted successfully',
      data: { user_id: userId }
    });
  } catch (error) {
    logError('Delete user', error);
    return res.status(500).json({ status: false, message: 'Failed to delete user' });
  }
};

export const listCars = async (req, res) => {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { page = 1, per_page = 15, status = 'all', car_type = 'all', search = '', sort = 'recently_added' } = req.query;

    const limit = parseInt(per_page);
    const offset = (parseInt(page) - 1) * limit;

    // sort: recently_added (default) | a_z (by vehicle_make asc)
    const sortAscending = sort === 'a_z';
    const sortColumn = sort === 'a_z' ? 'vehicle_make' : 'created_at';

    let query = supabaseAdmin
      .from('cars')
      .select('*', { count: 'exact' })
      .is('deleted_at', null)
      .order(sortColumn, { ascending: sortAscending })
      .range(offset, offset + limit - 1);

    if (status !== 'all') {
      query = query.eq('status', status);
    }

    if (car_type !== 'all') {
      query = query.eq('car_type', car_type);
    }

    if (search && search.trim()) {
      const term = search.trim();
      query = query.or(
        `vehicle_make.ilike.%${term}%,vehicle_model.ilike.%${term}%,registration_no.ilike.%${term}%,name_of_owner.ilike.%${term}%`
      );
    }
    
    const { data: cars, count, error } = await query;
    
    if (error) {
      logError('List cars', error);
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
    logError('List cars', error);
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
      logError('Failed to fetch user email', err);
    }
    
    // Fetch recent orders for this car
    const { data: orders } = await supabaseAdmin
      .from('renewal_orders')
      .select('id, order_number, order_type, amount_paid, status, selected_items, created_at')
      .eq('car_id', car.id)
      .order('created_at', { ascending: false })
      .limit(5);

    // Fetch recent transactions for this car
    const { data: transactions } = await supabaseAdmin
      .from('payment_transactions')
      .select('id, reference, amount, status, payment_gateway, payment_type, created_at, paid_at')
      .eq('car_id', car.id)
      .in('status', ['successful', 'pending', 'failed'])
      .order('created_at', { ascending: false })
      .limit(5);

    const formattedCar = {
      ...car,
      user: profile ? {
        ...profile,
        email: userEmail,
        name: `${profile.first_name || ''} ${profile.last_name || ''}`.trim()
      } : null,
      orders: (orders || []).map(o => ({
        ...o,
        amount_paid: koboToNaira(o.amount_paid)
      })),
      transactions: (transactions || []).map(t => ({
        ...t,
        amount: koboToNaira(t.amount)
      }))
    };
    
    return res.status(200).json({
      status: true,
      message: 'Car retrieved successfully',
      data: formattedCar
    });
  } catch (error) {
    logError('Get car details', error);
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
    logError('Get payment metrics', error);
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
    logError('Get gateway health', error);
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
    logError('Get dashboard stats', error);
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
        payment_transactions:transaction_id ( id, reference, amount, status, paid_at, payment_gateway )
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
    logError('Get recent orders', error);
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
    logError('Get recent transactions', error);
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
        payment_transactions:transaction_id ( id, reference, amount, status, payment_gateway, payment_type, metadata )
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status && status !== 'all') {
      query = query.eq('status', frontendStatusToDB(status));
    }

    // Order number search at DB level — avoids loading full pages to filter in JS
    if (search) {
      query = query.ilike('order_number', `%${search}%`);
    }

    const { data: orders, count, error } = await query;
    if (error) {
      logError('List orders', error);
      return res.status(500).json({ status: false, message: 'Failed to retrieve orders' });
    }

    const userIds = [...new Set((orders || []).map(o => o.user_id))];
    const { profileMap, emailMap } = await fetchUserDetails(supabaseAdmin, userIds);

    const stateCodes = [...new Set((orders || []).map(o => o.delivery_state).filter(Boolean))];
    const stateNameMap = new Map();
    if (stateCodes.length > 0) {
      const { data: states } = await supabaseAdmin
        .from('states')
        .select('code, name')
        .in('code', stateCodes);
      (states || []).forEach(s => stateNameMap.set(s.code, s.name));
    }

    const formatted = (orders || []).map(o =>
      formatOrder(
        o,
        profileMap.get(o.user_id),
        emailMap.get(o.user_id),
        stateNameMap.get(o.delivery_state),
        o.delivery_lga
      )
    );

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
    logError('List orders', error);
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
                      registration_no, chasis_no, engine_no, expiry_date, preferred_name, type ),
        payment_transactions:transaction_id ( id, reference, amount, status, paid_at, channel, payment_gateway, payment_type, metadata )
      `)
      .eq('order_number', orderNumber)
      .maybeSingle();

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
    logError('Get order details', error);
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
        payment_transactions:transaction_id ( id, reference, amount, status, paid_at, payment_gateway, payment_type, metadata )
      `)
      .single();

    if (updateError) {
      logError('Update order status', updateError);
      return response.serverError(res, 'Failed to update order status');
    }

    const { profileMap, emailMap } = await fetchUserDetails(supabaseAdmin, [updated.user_id]);
    const formatted = formatOrder(updated, profileMap.get(updated.user_id), emailMap.get(updated.user_id), null, updated.delivery_lga);

    // Fire-and-forget: notify user when admin starts processing their order
    if (dbStatus === 'processing') {
      const userEmail = emailMap.get(updated.user_id);
      const profile = profileMap.get(updated.user_id);
      if (userEmail) {
        sendOrderInProgressEmail({
          to: userEmail,
          firstName: profile?.first_name || 'User',
          orderNumber: updated.order_number,
          orderType: updated.order_type,
        }).catch(err => logError('Order in-progress email failed', err));
      }
      createInAppNotification(
        updated.user_id,
        'order',
        'order_in_progress',
        `Your order ${updated.order_number} is now being processed by our team.`
      ).catch(err => logError('Order in-progress notification failed', err));
    }

    // Fire-and-forget: notify user when admin completes or declines their order
    if (dbStatus === 'completed' || dbStatus === 'cancelled') {
      const userEmail = emailMap.get(updated.user_id);
      const profile = profileMap.get(updated.user_id);
      if (userEmail) {
        if (dbStatus === 'completed') {
          sendOrderCompletedEmail({
            to: userEmail,
            firstName: profile?.first_name || 'User',
            orderNumber: updated.order_number,
            carDetails: updated.cars,
            newExpiryDate: updateData.new_expiry_date || null,
          }).catch(err => logError('Order completed email failed', err));

          createInAppNotification(
            updated.user_id,
            'order',
            'order_completed',
            `Your renewal order ${updated.order_number} has been completed. Your vehicle documents are ready.`
          ).catch(err => logError('Order completed notification failed', err));
        } else {
          createInAppNotification(
            updated.user_id,
            'order',
            'order_declined',
            `Your renewal order ${updated.order_number} was declined. ${notes ? 'Reason: ' + notes : 'Please contact support for details.'}`
          ).catch(err => logError('Order declined notification failed', err));
        }
      }

      // WhatsApp hook — fire-and-forget, isolated from email/in-app logic above
      // Only sends when WHATSAPP_REMINDERS_ENABLED=true and user has a phone number
      sendOrderUpdateWhatsApp({
        phone:   profile?.phone_number || null,
        name:    profile?.first_name   || 'User',
        orderId: updated.order_number,
        status:  dbStatus,
      }).catch(err => logError('WhatsApp order update failed (non-blocking)', err));
    }

    return res.status(200).json({ status: true, message: 'Order status updated successfully', data: formatted });
  } catch (error) {
    logError('Update order status', error);
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
      : status === 'abandoned' ? 'abandoned'
      : null;

    let query = supabaseAdmin
      .from('payment_transactions')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (dbStatus) {
      query = query.eq('status', dbStatus);
    }

    // Reference search at DB level
    if (search) {
      query = query.ilike('reference', `%${search}%`);
    }

    const { data: transactions, count, error } = await query;
    if (error) {
      logError('List transactions', error);
      return res.status(500).json({ status: false, message: 'Failed to retrieve transactions' });
    }

    const userIds = [...new Set((transactions || []).map(t => t.user_id).filter(Boolean))];
    const { profileMap, emailMap } = await fetchUserDetails(supabaseAdmin, userIds);

    // Summary uses aggregate counts — fetch only what we need, not full rows
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

    const formatted = (transactions || []).map(t => {
      const profile = profileMap.get(t.user_id);
      return {
        id: t.id,
        transaction_id: t.reference,
        gateway_reference: t.paystack_reference || t.monicredit_order_id || t.reference,
        payment_gateway: t.payment_gateway || 'paystack',
        amount: koboToNaira(t.amount),
        status: t.status,
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
    logError('List transactions', error);
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
    logError('Get failed transactions', error);
    return response.serverError(res, 'Failed to retrieve failed transactions');
  }
};

// GET /admin/transactions/:reference
export const getTransactionDetails = async (req, res) => {
  try {
    const { reference } = req.params;
    const supabaseAdmin = getSupabaseAdmin();

    const { data: tx, error } = await supabaseAdmin
      .from('payment_transactions')
      .select('*')
      .eq('reference', reference)
      .single();

    if (error || !tx) {
      return res.status(404).json({ status: false, message: 'Transaction not found' });
    }

    const { profileMap, emailMap } = await fetchUserDetails(supabaseAdmin, [tx.user_id]);
    const profile = profileMap.get(tx.user_id);

    // Fetch the linked order if it exists
    const { data: order } = await supabaseAdmin
      .from('renewal_orders')
      .select('id, order_number, status, amount_paid')
      .eq('transaction_id', tx.id)
      .maybeSingle();

    // Fetch car details
    const { data: car } = tx.car_id
      ? await supabaseAdmin.from('cars').select('id, slug, vehicle_make, vehicle_model, registration_no').eq('id', tx.car_id).single()
      : { data: null };

    // Parse metadata so we can surface form details (plate type, license type, etc.)
    let txMeta = {};
    try {
      txMeta = tx.metadata
        ? (typeof tx.metadata === 'string' ? JSON.parse(tx.metadata) : tx.metadata)
        : {};
    } catch { txMeta = {}; }

    return res.status(200).json({
      status: true,
      message: 'Transaction retrieved',
      data: {
        id: tx.id,
        reference: tx.reference,
        gateway_reference: tx.paystack_reference || tx.monicredit_order_id || tx.reference,
        payment_gateway: tx.payment_gateway || 'paystack',
        amount: koboToNaira(tx.amount),
        status: tx.status,
        payment_type: tx.payment_type,
        payment_description: tx.payment_type?.replace(/_/g, ' '),
        channel: tx.channel,
        created_at: tx.created_at,
        paid_at: tx.paid_at,
        updated_at: tx.updated_at,
        // Form details — what the user actually filled in
        plate_type: txMeta.plateType || null,
        plate_sub_type: txMeta.subType || null,
        license_type: txMeta.licenseType || null,
        license_duration: txMeta.licenseDuration || null,
        renewal_months: txMeta.renewal_months || null,
        delivery_details: txMeta.delivery_details || null,
        user: profile ? {
          id: profile.id,
          name: `${profile.first_name || ''} ${profile.last_name || ''}`.trim(),
          email: emailMap.get(tx.user_id) || null,
          phone_number: profile.phone_number,
        } : null,
        car: car ? {
          id: car.id,
          slug: car.slug,
          vehicle_make: car.vehicle_make,
          vehicle_model: car.vehicle_model,
          registration_no: car.registration_no,
        } : null,
        order: order ? {
          id: order.id,
          order_number: order.order_number,
          status: dbStatusToFrontend(order.status),
          amount_paid: koboToNaira(order.amount_paid),
        } : null,
      },
    });
  } catch (error) {
    logError('Get transaction details', error);
    return res.status(500).json({ status: false, message: 'Failed to retrieve transaction' });
  }
};

// ─── Document management (admin) ─────────────────────────────────────────────

// GET /admin/documents
export const listDocuments = async (req, res) => {
  try {
    const { user_id, car_id, document_type, status, page, limit } = req.query;
    const result = await adminListDocuments({
      userId: user_id || null,
      carId: car_id ? parseInt(car_id, 10) : null,
      documentType: document_type || null,
      status: status || null,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
    });
    return res.status(200).json({
      status: true,
      message: 'Documents retrieved',
      data: result.documents,
      pagination: {
        total: result.total,
        page: parseInt(req.query.page || 1, 10),
        limit: parseInt(req.query.limit || 20, 10),
      },
    });
  } catch (error) {
    logError('Admin list documents', error);
    return res.status(500).json({ status: false, message: 'Failed to retrieve documents' });
  }
};

// GET /admin/documents/:id
export const getDocumentDetails = async (req, res) => {
  try {
    const doc = await getDocumentById(parseInt(req.params.id, 10));
    if (!doc) {
      return res.status(404).json({ status: false, message: 'Document not found' });
    }
    const supabaseAdmin = getSupabaseAdmin();
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('first_name, last_name, email, phone_number')
      .eq('id', doc.user_id)
      .single();
    return res.status(200).json({
      status: true,
      message: 'Document retrieved',
      data: { ...doc, user: profile },
    });
  } catch (error) {
    logError('Admin get document', error);
    return res.status(500).json({ status: false, message: 'Failed to retrieve document' });
  }
};

// POST /admin/documents/upload
export const adminUploadDocument = async (req, res) => {
  try {
    const adminId = req.admin?.id || req.user?.id;
    const { user_id, car_id, car_slug, document_type, document_category, description } = req.body;
    const file = req.file || req.files?.file?.[0];

    if (!document_type || !['car', 'driver_license'].includes(document_type)) {
      return res.status(400).json({
        status: false,
        message: 'document_type (car|driver_license) is required',
      });
    }

    // driver_license requires user_id; car uploads can derive user_id from the car
    if (document_type === 'driver_license' && !user_id) {
      return res.status(400).json({
        status: false,
        message: 'user_id is required for driver_license documents',
      });
    }

    if (document_type === 'car' && !car_id && !car_slug) {
      return res.status(400).json({
        status: false,
        message: 'car_id or car_slug is required for car documents',
      });
    }

    if (!file || !file.buffer) {
      return res.status(400).json({ status: false, message: 'No file provided' });
    }

    const supabaseAdmin = getSupabaseAdmin();
    let car = null;
    let effectiveUserId = user_id;

    if (document_type === 'car') {
      let carQuery = supabaseAdmin.from('cars').select('id, slug, user_id').is('deleted_at', null);
      if (car_slug) carQuery = carQuery.eq('slug', car_slug);
      else carQuery = carQuery.eq('id', car_id);
      const { data: carRow } = await carQuery.single();
      if (!carRow) {
        return res.status(404).json({ status: false, message: 'Car not found' });
      }
      // Validate ownership only when caller explicitly passes a user_id
      if (user_id && carRow.user_id !== user_id) {
        return res.status(404).json({ status: false, message: 'Car does not belong to specified user' });
      }
      car = carRow;
      effectiveUserId = car.user_id; // derive from car — admin doesn't need to know the user ID
    }

    const fileUrl = document_type === 'car'
      ? await uploadFile(file.buffer, file.originalname, file.mimetype, effectiveUserId, car.slug)
      : await uploadFile(file.buffer, file.originalname, file.mimetype, effectiveUserId, 'driver_license');

    const doc = await createDocument({
      userId: effectiveUserId,
      carId: document_type === 'car' ? car.id : null,
      documentType: document_type,
      documentCategory: document_category || null,
      description: description || null,
      fileUrl,
      uploadedByType: 'admin',
      uploadedByUserId: adminId,
    });

    return res.status(201).json({
      status: true,
      message: 'Document uploaded successfully',
      data: { document: doc },
    });
  } catch (error) {
    logError('Admin upload document', error);
    return res.status(500).json({ status: false, message: 'Failed to upload document' });
  }
};

// PUT /admin/documents/:id/approve
export const approveDocument = async (req, res) => {
  try {
    const doc = await updateDocumentStatus(parseInt(req.params.id, 10), 'approved');

    // WhatsApp hook — fire-and-forget, does not affect the response
    // Looks up user profile for phone number and car name, then sends notification
    if (doc?.user_id) {
      (async () => {
        try {
          const supabaseAdmin = getSupabaseAdmin();

          // Fetch user phone and name
          const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('first_name, phone_number')
            .eq('id', doc.user_id)
            .single();

          // Fetch car name if this is a car document
          let vehicleName = 'your vehicle';
          if (doc.car_id) {
            const { data: car } = await supabaseAdmin
              .from('cars')
              .select('vehicle_make, vehicle_model, vehicle_year')
              .eq('id', doc.car_id)
              .single();
            if (car) {
              vehicleName = [car.vehicle_year, car.vehicle_make, car.vehicle_model]
                .filter(Boolean)
                .join(' ');
            }
          }

          await sendDocumentReadyWhatsApp({
            phone:       profile?.phone_number || null,
            name:        profile?.first_name   || 'User',
            vehicleName,
            documentUrl: doc.file_url || '',
          });
        } catch (err) {
          logError('WhatsApp document ready notification failed (non-blocking)', err);
        }
      })();
    }

    return res.status(200).json({
      status: true,
      message: 'Document approved',
      data: { document: doc },
    });
  } catch (error) {
    logError('Admin approve document', error);
    return res.status(500).json({ status: false, message: 'Failed to approve document' });
  }
};

// PUT /admin/documents/:id/reject
export const rejectDocument = async (req, res) => {
  try {
    const { reason } = req.body || {};
    const doc = await updateDocumentStatus(parseInt(req.params.id, 10), 'rejected', reason);
    return res.status(200).json({
      status: true,
      message: 'Document rejected',
      data: { document: doc },
    });
  } catch (error) {
    logError('Admin reject document', error);
    return res.status(500).json({ status: false, message: 'Failed to reject document' });
  }
};

// GET /admin/documents/:id/download — redirect browser to the raw file URL
export const downloadDocument = async (req, res) => {
  try {
    const doc = await getDocumentById(parseInt(req.params.id, 10));
    if (!doc) {
      return res.status(404).json({ status: false, message: 'Document not found' });
    }
    // Return the URL so the frontend can open it — avoids CORS issues with direct redirect
    return res.status(200).json({ status: true, url: doc.file_url });
  } catch (error) {
    logError('Admin download document', error);
    return res.status(500).json({ status: false, message: 'Failed to retrieve document' });
  }
};

// GET /admin/users/search?q=name_or_email — used by document upload modal
export const searchUsers = async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q || q.length < 2) {
      return res.status(200).json({ status: true, data: [] });
    }
    const supabaseAdmin = getSupabaseAdmin();
    const { data: profiles, error } = await supabaseAdmin
      .from('profiles')
      .select('id, first_name, last_name, email, phone_number')
      .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%,phone_number.ilike.%${q}%`)
      .limit(15);

    if (error) {
      logError('Admin search users', error);
      return res.status(500).json({ status: false, message: 'Search failed' });
    }

    return res.status(200).json({
      status: true,
      data: (profiles || []).map((p) => ({
        id: p.id,
        name: `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Unknown',
        email: p.email,
        phone_number: p.phone_number,
      })),
    });
  } catch (error) {
    logError('Admin search users', error);
    return res.status(500).json({ status: false, message: 'Search failed' });
  }
};

// GET /admin/users/:userId/cars — fetch cars for a specific user (for upload modal)
export const getUserCars = async (req, res) => {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { data: cars, error } = await supabaseAdmin
      .from('cars')
      .select('id, slug, vehicle_make, vehicle_model, registration_no, status')
      .eq('user_id', req.params.userId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (error) {
      logError('Admin get user cars', error);
      return res.status(500).json({ status: false, message: 'Failed to fetch cars' });
    }

    return res.status(200).json({ status: true, data: cars || [] });
  } catch (error) {
    logError('Admin get user cars', error);
    return res.status(500).json({ status: false, message: 'Failed to fetch cars' });
  }
};

// PUT /admin/transactions/:reference/mark-paid — manually mark a pending payment as successful
// Used when gateway webhook fails but payment was confirmed out-of-band.
export const markTransactionPaid = async (req, res) => {
  try {
    const { reference } = req.params;
    const transaction = await getTransactionByReference(reference);

    if (!transaction) {
      return res.status(404).json({ status: false, message: 'Transaction not found' });
    }

    if (transaction.status === PAYMENT_STATUS.SUCCESSFUL) {
      // Check if the order was actually created — if not, create it now
      const supabaseAdmin = getSupabaseAdmin();
      const { data: existingOrder } = await supabaseAdmin
        .from('renewal_orders')
        .select('id, order_number')
        .eq('transaction_id', transaction.id)
        .maybeSingle();

      if (existingOrder) {
        return res.status(400).json({
          status: false,
          message: 'Transaction is already successful and order already exists',
          data: { orderId: existingOrder.id, orderNumber: existingOrder.order_number },
        });
      }
      // Order is missing despite successful payment — fall through to create it
    }

    let metadata = {};
    try {
      metadata = typeof transaction.metadata === 'string'
        ? JSON.parse(transaction.metadata)
        : (transaction.metadata || {});
    } catch {
      metadata = {};
    }

    const isPlateNumber = metadata.payment_type === 'plate_number';
    const isDriverLicense = metadata.payment_type === 'driver_license';
    const isSubscription = metadata.subscription_id || metadata.is_subscription;
    const orderType = isDriverLicense
      ? ORDER_TYPE.DRIVER_LICENSE
      : isPlateNumber
        ? ORDER_TYPE.PLATE_NUMBER
        : (isSubscription ? ORDER_TYPE.RENEWAL_AUTO : ORDER_TYPE.RENEWAL_MANUAL);
    const paymentScheduleIds = metadata.paymentScheduleId || metadata.payment_schedule_id || metadata.selected_items || [];

    const alreadySuccessful = transaction.status === PAYMENT_STATUS.SUCCESSFUL;

    if (!alreadySuccessful) {
      // For abandoned transactions: reset to pending first so the RPC can run its
      // normal flow (which expects status = 'pending' before creating the order)
      if (transaction.status === PAYMENT_STATUS.ABANDONED) {
        logInfo('[markTransactionPaid] Recovering abandoned transaction', { reference });
        await updateTransactionStatus(reference, {
          status: PAYMENT_STATUS.PENDING,
          channel: null,
          authorization_code: null,
          paid_at: null,
        });
      }
      await updateTransactionStatus(reference, {
        status: PAYMENT_STATUS.SUCCESSFUL,
        channel: 'manual',
        authorization_code: null,
        paid_at: new Date().toISOString(),
      });
    }

    const processResult = await processPaymentSuccess({
      reference,
      status: PAYMENT_STATUS.SUCCESSFUL,
      channel: alreadySuccessful ? transaction.channel || 'manual' : 'manual',
      authorization_code: null,
      paid_at: alreadySuccessful ? (transaction.paid_at || new Date().toISOString()) : new Date().toISOString(),
      orderType,
      renewalMonths: metadata.renewal_months || 12,
      selectedItems: paymentScheduleIds,
      renewalAmount: metadata.renewal_amount || transaction.amount,
      deliveryFee: metadata.delivery_fee || 0,
      deliveryAddress: metadata.delivery_details?.address || null,
      deliveryState: metadata.delivery_details?.state || null,
      deliveryLGA: metadata.delivery_details?.lga || null,
      deliveryContact: metadata.delivery_details?.contact || null,
      metadata,
    });

    // If the RPC returned alreadyProcessed OR returned no orderId (can happen when the
    // transaction status was updated to successful before the RPC ran, e.g. for
    // abandoned transactions that were recovered), create the order directly.
    let finalOrderId = processResult.orderId;
    if (processResult.alreadyProcessed && !finalOrderId) {
      const supabaseAdmin = getSupabaseAdmin();
      const { data: directOrder, error: orderInsertError } = await supabaseAdmin
        .from('renewal_orders')
        .insert({
          order_number: generateOrderNumber(),
          user_id: transaction.user_id,
          car_id: transaction.car_id || null,
          transaction_id: transaction.id,
          order_type: orderType,
          status: 'pending',
          amount_paid: transaction.amount,
          currency: transaction.currency || 'NGN',
          renewal_months: metadata.renewal_months || 12,
          selected_items: paymentScheduleIds || [],
          renewal_amount: metadata.renewal_amount || transaction.amount,
          delivery_fee: metadata.delivery_fee || 0,
          metadata: metadata,
        })
        .select('id')
        .single();

      if (!orderInsertError && directOrder) {
        finalOrderId = directOrder.id;
        // Also update car status to approved if there's a car
        if (transaction.car_id) {
          await supabaseAdmin
            .from('cars')
            .update({ status: 'approved', updated_at: new Date().toISOString() })
            .eq('id', transaction.car_id);
        }
      } else if (orderInsertError) {
        logError('mark-paid: direct order insert failed', { error: orderInsertError.message, reference });
      }
    }

    const updatedTransaction = await getTransactionByReference(reference);
    const createdOrder = finalOrderId ? await getOrderById(finalOrderId).catch(() => null) : null;

    if (finalOrderId) {
      try {
        await PaymentSuccessService.processPaymentSuccessSideEffects({
          transaction: updatedTransaction,
          gatewayData: { channel: transaction.channel || 'manual' },
          order: createdOrder,
        });
      } catch (notifyError) {
        logError('mark-paid: side-effects failed', { error: notifyError.message, reference });
      }
    }

    logInfo('[Admin] Transaction marked as paid', { reference, orderId: finalOrderId, alreadySuccessful });

    return res.status(200).json({
      status: true,
      message: alreadySuccessful
        ? 'Order created for existing successful payment'
        : 'Transaction marked as paid and order created',
      data: {
        reference,
        orderId: finalOrderId,
        alreadyProcessed: processResult.alreadyProcessed && !finalOrderId,
      },
    });
  } catch (error) {
    logError('Admin mark transaction paid', error);
    return res.status(500).json({ status: false, message: 'Failed to process transaction' });
  }
};

// PUT /admin/transactions/:reference/mark-failed — manually mark a transaction as failed
// Used when admin confirms with the payment gateway that no money was received.
export const markTransactionFailed = async (req, res) => {
  try {
    const { reference } = req.params;
    const transaction = await getTransactionByReference(reference);

    if (!transaction) {
      return res.status(404).json({ status: false, message: 'Transaction not found' });
    }

    if (transaction.status === PAYMENT_STATUS.SUCCESSFUL) {
      // Check if there's already an order — can't mark as failed if order exists
      const supabaseAdmin = getSupabaseAdmin();
      const { data: existingOrder } = await supabaseAdmin
        .from('renewal_orders')
        .select('id, order_number')
        .eq('transaction_id', transaction.id)
        .maybeSingle();

      if (existingOrder) {
        return res.status(400).json({
          status: false,
          message: 'Cannot mark as failed — this transaction already has a linked order',
          data: { orderNumber: existingOrder.order_number },
        });
      }
    }

    if (transaction.status === 'failed') {
      return res.status(400).json({ status: false, message: 'Transaction is already marked as failed' });
    }

    await updateTransactionStatus(reference, { status: 'failed' });

    logInfo('[markTransactionFailed] Transaction manually marked as failed', { reference });

    return res.status(200).json({
      status: true,
      message: 'Transaction marked as failed',
      data: { reference },
    });
  } catch (error) {
    logError('Admin mark transaction failed', error);
    return res.status(500).json({ status: false, message: 'Failed to update transaction' });
  }
};

// ─── WhatsApp Broadcast ───────────────────────────────────────────────────────

/**
 * POST /api/admin/notifications/add-car-reminder
 *
 * Sends a WhatsApp message to every user who has no cars on the platform.
 * Only targets users with a phone number.
 *
 * Query params:
 *   ?dry_run=true  — preview the count without sending anything
 *
 * Processed in batches of 10 with a 1 s delay between batches to stay
 * well within Twilio's WhatsApp throughput limits.
 */
export async function broadcastAddCarReminder(req, res) {
  const supabase = getSupabaseAdmin();
  const dryRun = req.query.dry_run === 'true';

  try {
    if (process.env.WHATSAPP_REMINDERS_ENABLED !== 'true') {
      return response.error(
        res,
        'WhatsApp notifications are disabled. Set WHATSAPP_REMINDERS_ENABLED=true to enable.',
        400,
      );
    }

    // Step 1: collect user_ids that already have at least one active car
    const { data: carsData, error: carsError } = await supabase
      .from('cars')
      .select('user_id')
      .eq('is_deleted', false);

    if (carsError) {
      logError('[Broadcast] Failed to query cars', { error: carsError.message });
      return response.serverError(res, 'Failed to query cars');
    }

    const userIdsWithCars = [...new Set((carsData || []).map(c => c.user_id))];

    // Step 2: profiles without cars that have a phone number and are not suspended
    let profilesQuery = supabase
      .from('profiles')
      .select('user_id, first_name, phone_number')
      .not('phone_number', 'is', null)
      .neq('is_suspended', true);

    if (userIdsWithCars.length > 0) {
      profilesQuery = profilesQuery.not('user_id', 'in', `(${userIdsWithCars.join(',')})`);
    }

    const { data: users, error: profilesError } = await profilesQuery;

    if (profilesError) {
      logError('[Broadcast] Failed to query users without cars', { error: profilesError.message });
      return response.serverError(res, 'Failed to query users');
    }

    const total = (users || []).length;

    if (dryRun) {
      logInfo('[Broadcast] Dry run — add-car reminder', { total });
      return response.success(res, {
        dry_run: true,
        total_users_without_cars: total,
        message: `${total} user(s) would receive a notification. Remove dry_run=true to send.`,
      });
    }

    if (total === 0) {
      return response.success(res, {
        message: 'No users without cars to notify',
        total_users_without_cars: 0,
        attempted: 0,
      });
    }

    const appUrl = `${process.env.FRONTEND_URL || 'https://app.motoka.ng'}/dashboard`;
    const BATCH_SIZE = 10;
    const BATCH_DELAY_MS = 1000;

    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      const batch = users.slice(i, i + BATCH_SIZE);

      await Promise.allSettled(
        batch.map(user =>
          sendAddCarReminderWhatsApp({
            phone: user.phone_number,
            name: user.first_name || 'there',
            appUrl,
          }),
        ),
      );

      if (i + BATCH_SIZE < users.length) {
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }

    logInfo('[Broadcast] Add-car reminder broadcast complete', { total, attempted: total });

    return response.success(res, {
      message: 'Broadcast complete',
      total_users_without_cars: total,
      attempted: total,
    });
  } catch (err) {
    logError('[Broadcast] Unexpected error in broadcastAddCarReminder', { error: err.message });
    return response.serverError(res, 'Broadcast failed');
  }
}

// ─── Guest Orders ─────────────────────────────────────────────────────────────

/**
 * GET /api/admin/guest-orders
 *
 * Lists all guest renewal orders with optional filters.
 *
 * Query params:
 *   ?page=1 &limit=20 &status=pending_payment|payment_success|payment_failed
 *   &search=<plate or email>
 */
export const listGuestOrders = async (req, res) => {
  try {
    const supabase = getSupabaseAdmin();
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    const { status, search } = req.query;

    let query = supabase
      .from('guest_renewal_orders')
      .select('id, guest_name, guest_email, guest_phone, plate_number, payment_status, payment_gateway, total_amount, created_at, linked_user_id, payment_reference', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (status) query = query.eq('payment_status', status);
    if (search) {
      query = query.or(`plate_number.ilike.%${search}%,guest_email.ilike.%${search}%,guest_name.ilike.%${search}%`);
    }

    const { data: orders, count, error } = await query;
    if (error) {
      logError('[Admin] listGuestOrders query error', error);
      return response.serverError(res, 'Failed to retrieve guest orders');
    }

    return response.success(res, {
      orders: orders || [],
      pagination: {
        current_page: page,
        limit,
        total: count || 0,
        total_pages: Math.ceil((count || 0) / limit),
        has_next: page < Math.ceil((count || 0) / limit),
        has_prev: page > 1
      }
    }, 'Guest orders retrieved');
  } catch (err) {
    logError('[Admin] listGuestOrders error', err);
    return response.serverError(res, 'Failed to retrieve guest orders');
  }
};

/**
 * GET /api/admin/guest-orders/:orderId
 *
 * Returns full details of a single guest renewal order including
 * delivery info, selected items, and linked user.
 */
export const getGuestOrderDetails = async (req, res) => {
  try {
    const { orderId } = req.params;
    const supabase = getSupabaseAdmin();

    const { data: order, error } = await supabase
      .from('guest_renewal_orders')
      .select('*, guest_customers(name, email, phone)')
      .eq('id', orderId)
      .maybeSingle();

    if (error || !order) {
      return response.notFound(res, 'Guest order not found');
    }

    return response.success(res, order, 'Guest order retrieved');
  } catch (err) {
    logError('[Admin] getGuestOrderDetails error', err);
    return response.serverError(res, 'Failed to retrieve guest order');
  }
};

// ─── Driver License Applications ───────────────────────────────────────────────

/**
 * GET /admin/driver-license-applications
 * Paginated list with optional filters: status, application_type, search (name/email)
 */
export const listDriverLicenseApplications = async (req, res) => {
  try {
    const supabase = getSupabaseAdmin();
    const {
      page = 1,
      limit = 20,
      status,
      application_type,
      search,
    } = req.query;

    const offset = (Number(page) - 1) * Number(limit);

    let query = supabase
      .from('driver_license_applications')
      .select(`
        id, user_id, application_type, status, is_current,
        full_name, phone, license_number,
        order_id, created_at, updated_at,
        renewal_orders!driver_license_applications_order_id_fkey(id, status, created_at)
      `, { count: 'exact' })
      .eq('is_current', true)
      .order('updated_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1);

    if (status) query = query.eq('status', status);
    if (application_type) query = query.eq('application_type', application_type);
    if (search) query = query.ilike('full_name', `%${search}%`);

    const { data, error, count } = await query;

    if (error) {
      logError('[Admin] listDriverLicenseApplications error', error);
      return response.serverError(res, 'Failed to list driver license applications');
    }

    return response.success(res, {
      applications: data || [],
      pagination: {
        total: count || 0,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil((count || 0) / Number(limit)),
      },
    });
  } catch (err) {
    logError('[Admin] listDriverLicenseApplications error', err);
    return response.serverError(res, 'Failed to list driver license applications');
  }
};

/**
 * GET /admin/driver-license-applications/:id
 * Full detail including all form fields, linked order, and user info from auth.users
 */
export const getDriverLicenseApplicationDetails = async (req, res) => {
  try {
    const supabase = getSupabaseAdmin();
    const { id } = req.params;

    const { data: application, error } = await supabase
      .from('driver_license_applications')
      .select(`
        *,
        renewal_orders!driver_license_applications_order_id_fkey(
          id, status, created_at, completed_at, order_type
        )
      `)
      .eq('id', id)
      .maybeSingle();

    if (error || !application) {
      return response.notFound(res, 'Driver license application not found');
    }

    // Fetch user email from auth.users (service role can do this)
    const { data: authUser } = await supabase.auth.admin.getUserById(application.user_id);

    return response.success(res, {
      ...application,
      user_email: authUser?.user?.email || null,
    }, 'Application retrieved');
  } catch (err) {
    logError('[Admin] getDriverLicenseApplicationDetails error', err);
    return response.serverError(res, 'Failed to retrieve application');
  }
};

const VALID_ADMIN_STATUSES = ['submitted', 'approved', 'rejected', 'expired'];

/**
 * PATCH /admin/driver-license-applications/:id/status
 * Update status with optional rejection notes.
 * Allowed transitions: submitted → approved | rejected; any → expired
 */
export const updateDriverLicenseApplicationStatus = async (req, res) => {
  try {
    const supabase = getSupabaseAdmin();
    const { id } = req.params;
    const { status, notes } = req.body;

    if (!status || !VALID_ADMIN_STATUSES.includes(status)) {
      return response.error(res, `status must be one of: ${VALID_ADMIN_STATUSES.join(', ')}`, 400);
    }

    const { data: existing, error: fetchErr } = await supabase
      .from('driver_license_applications')
      .select('id, status, user_id, application_type, full_name')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr || !existing) {
      return response.notFound(res, 'Driver license application not found');
    }

    const updatePayload = {
      status,
      updated_at: new Date().toISOString(),
    };
    if (notes !== undefined) updatePayload.admin_notes = notes;

    const { data: updated, error: updateErr } = await supabase
      .from('driver_license_applications')
      .update(updatePayload)
      .eq('id', id)
      .select('*')
      .single();

    if (updateErr) {
      logError('[Admin] updateDriverLicenseApplicationStatus update error', updateErr);
      return response.serverError(res, 'Failed to update application status');
    }

    logInfo('[Admin] Driver license application status updated', {
      id, previousStatus: existing.status, newStatus: status, adminId: req.admin?.id,
    });

    return response.success(res, updated, `Application status updated to ${status}`);
  } catch (err) {
    logError('[Admin] updateDriverLicenseApplicationStatus error', err);
    return response.serverError(res, 'Failed to update application status');
  }
};
