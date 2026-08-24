import { getSupabaseAdmin } from '../config/supabase.js';
import * as response from '../utils/responses.js';
import { parse as csvParse } from 'csv-parse/sync';
import { sanitizeCarInput } from '../utils/carSanitization.js';
import { buildCarData, extractNormalizedIdentifiers } from '../utils/carDataBuilder.js';
import { createCar, CarError } from '../services/car.service.js';
import paymentMetrics from '../services/payment/metrics.service.js';
import {
  adminListDocuments,
  getDocumentById,
  createDocument,
  updateDocumentStatus
} from '../services/document.service.js';
import { uploadFile, getSignedUrl, withSignedUrls } from '../services/fileUpload.service.js';
import { healthMonitor } from '../services/payment/gateway/health-monitor.js';
import { gatewayManager } from '../services/payment/gateway/gateway-manager.js';
import { completeOrder, OrderError } from '../services/payment/order.service.js';
import { getDeliveryProgressForOrder, getDeliveryProgressForGuestOrder } from '../services/courier/deliveryProgress.service.js';
import { invalidateProfileCache } from '../middleware/authenticate.js';
import { sendOrderCompletedEmail, sendOrderInProgressEmail } from '../services/email/paymentEmail.service.js';
import { createInAppNotification } from '../services/notification.service.js';
import { logError, logInfo } from '../utils/logger.js';
import {
  sendOrderUpdateWhatsApp,
  sendDocumentReadyWhatsApp,
  sendDocumentRejectedWhatsApp,
  sendAddCarReminderWhatsApp,
  sendExpiryReminderWhatsApp,
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
import { loadRenewalsSummary } from '../services/renewalsSummary.service.js';

// Paystack stores all amounts in kobo (100 kobo = ₦1). Convert before returning to frontend.
const koboToNaira = (kobo) => Math.round(parseFloat(kobo || 0)) / 100;

// ─── Status normalization helpers ────────────────────────────────────────────
// Canonical end-to-end: pending | processing | completed | cancelled
// (matches the DB enum). The frontend renders display labels — "New",
// "In Progress", "Cancelled" — via a label map, not through API translation.
//
// dbStatusToFrontend is now identity. Kept as a function so the call sites
// still read correctly and we can add log/metric instrumentation later if
// needed without another rename pass.
function dbStatusToFrontend(status) {
  return status;
}

// frontendStatusToDB tolerates the legacy spellings (in_progress, declined,
// new) so that a frontend deploy lagging a backend deploy doesn't break
// admin filters. New code on either side should use the canonical values.
function frontendStatusToDB(status) {
  if (status === 'in_progress') return 'processing';
  if (status === 'declined') return 'cancelled';
  if (status === 'new') return 'pending';
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
    renewal_state: order.renewal_state || null,
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
    
    // Email comes off the profile row we already loaded. Only profiles missing
    // an email fall back to the Auth API — previously EVERY row on the page hit
    // auth.admin.getUserById(), i.e. one extra HTTP call per user per page load.
    const emailMap = new Map();

    if (profiles && profiles.length > 0) {
      const needsLookup = [];

      profiles.forEach(profile => {
        if (profile.email) emailMap.set(profile.id, profile.email);
        else needsLookup.push(profile.id);
      });

      if (needsLookup.length > 0) {
        const userResults = await Promise.all(
          needsLookup.map(id =>
            supabaseAdmin.auth.admin.getUserById(id)
              .then(({ data }) => ({ id, email: data?.user?.email }))
              .catch(() => ({ id, email: null }))
          )
        );
        userResults.forEach(result => {
          if (result.email) emailMap.set(result.id, result.email);
        });
      }
    }

    const userIds = profiles.map(p => p.id);

    // Fetch car data: plate numbers + count per user (was count-only before)
    const { data: carRows } = await supabaseAdmin
      .from('cars')
      .select('user_id, plate_number, registration_no')
      .in('user_id', userIds)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    const carsCountMap = new Map();
    const platesMap = new Map();
    if (carRows) {
      carRows.forEach(car => {
        carsCountMap.set(car.user_id, (carsCountMap.get(car.user_id) || 0) + 1);
        const plate = car.plate_number || car.registration_no;
        if (plate) {
          if (!platesMap.has(car.user_id)) platesMap.set(car.user_id, []);
          platesMap.get(car.user_id).push(plate);
        }
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
      plates: platesMap.get(profile.id) || [],
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
    
    // Run all independent queries in parallel
    const [
      { data: { user: authUser } },
      { data: kyc },
      { data: carsData, count: carsCount },
      { data: ordersData, count: ordersCount },
      { data: txData },
    ] = await Promise.all([
      supabaseAdmin.auth.admin.getUserById(userId),
      supabaseAdmin.from('kycs').select('*').eq('user_id', userId).single(),
      supabaseAdmin
        .from('cars')
        .select('id, vehicle_make, vehicle_model, registration_no, plate_number, status, expiry_date, slug', { count: 'exact' })
        .eq('user_id', userId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(5),
      supabaseAdmin
        .from('renewal_orders')
        .select('id, order_number, order_type, status, amount_paid, created_at', { count: 'exact' })
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(5),
      supabaseAdmin
        .from('payment_transactions')
        .select('amount')
        .eq('user_id', userId)
        .eq('status', 'successful'),
    ]);

    // amount is stored in kobo — convert to naira
    const totalSpent = koboToNaira(
      (txData || []).reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0)
    );

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
    
    // authenticateAdmin sets req.admin; req.user is the legacy shape kept as a fallback
    if (userId === (req.admin?.id || req.user?.id)) {
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
        .select('id, first_name, last_name, user_id, email')
        .in('id', userIds);

      if (profiles) {
        profiles.forEach(profile => {
          profilesMap.set(profile.id, profile);
          if (profile.email) emailMap.set(profile.id, profile.email);
        });
      }

      // Auth API only for owners whose profile row has no email on it
      const missing = userIds.filter(id => !emailMap.has(id));
      if (missing.length > 0) {
        const userResults = await Promise.all(
          missing.map(userId =>
            supabaseAdmin.auth.admin.getUserById(userId)
              .then(({ data }) => ({ id: userId, email: data?.user?.email }))
              .catch(() => ({ id: userId, email: null }))
          )
        );
        userResults.forEach(result => {
          if (result.email) emailMap.set(result.id, result.email);
        });
      }
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
    .select('id, first_name, last_name, phone_number, email')
    .in('id', userIds);

  (profiles || []).forEach(p => {
    profileMap.set(p.id, p);
    if (p.email) emailMap.set(p.id, p.email);
  });

  // Only ids with no email on the profile row need the Auth API — this used to
  // fire one getUserById per id on every list render.
  const missing = userIds.filter(uid => !emailMap.has(uid));
  if (missing.length > 0) {
    const emailResults = await Promise.all(
      missing.map(uid =>
        supabaseAdmin.auth.admin.getUserById(uid)
          .then(({ data }) => ({ id: uid, email: data?.user?.email }))
          .catch(() => ({ id: uid, email: null }))
      )
    );
    emailResults.forEach(r => { if (r.email) emailMap.set(r.id, r.email); });
  }

  return { profileMap, emailMap };
}

// ─── Dashboard Stats ──────────────────────────────────────────────────────────
export const getDashboardStats = async (req, res) => {
  try {
    const supabaseAdmin = getSupabaseAdmin();

    const now = new Date();
    const monthStart = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;

    const settled = await Promise.allSettled([
      supabaseAdmin.from('renewal_orders').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('cars').select('id', { count: 'exact', head: true }).is('deleted_at', null),
      supabaseAdmin.from('profiles').select('id', { count: 'exact', head: true }).is('deleted_at', null).eq('is_admin', false),
      supabaseAdmin.from('payment_transactions').select('amount').eq('status', 'successful'),
      loadRenewalsSummary(supabaseAdmin),
    ]);

    const pick = (index) => {
      const result = settled[index];
      if (result.status !== 'fulfilled') {
        logError('Dashboard stat query failed', result.reason);
        return { count: 0, data: [] };
      }
      return result.value || { count: 0, data: [] };
    };

    const totalOrders = pick(0).count;
    const totalCars = pick(1).count;
    const totalUsers = pick(2).count;
    const amountData = pick(3).data;
    const renewalsSummary = settled[4].status === 'fulfilled' ? settled[4].value : null;
    const expiredThisMonth = renewalsSummary?.expired_this_month || 0;
    const expiredTotal = renewalsSummary?.expired_total || 0;

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
        expired_cars_this_month: expiredThisMonth || 0,
        expired_cars_total: expiredTotal || 0,
        expired_month: renewalsSummary?.expired_month || monthStart.slice(0, 7),
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

    const delivery = await getDeliveryProgressForOrder(order, { includeLabel: true });
    formatted.shipment = delivery.shipment;
    formatted.tracking = delivery.tracking;
    formatted.progress = delivery.progress;

    return res.status(200).json({ status: true, message: 'Order retrieved successfully', data: formatted });
  } catch (error) {
    logError('Get order details', error);
    return res.status(500).json({ status: false, message: 'Failed to retrieve order' });
  }
};

// ─── Update Order Status ──────────────────────────────────────────────────────
/**
 * POST /admin/orders/:orderNumber/reopen
 *
 * Undo an accidental cancellation.
 *
 * Cancelling used to be a one-way door: `completeOrder()` hard-rejects cancelled
 * orders, so there was no supported route back. In May 2026 an order was
 * cancelled by mistake after the customer's document had actually been processed
 * and delivered — the car's expiry was never advanced, and they sat on the
 * renewals list as 909 days overdue for three months.
 *
 * Reopening returns the order to `pending` so it can be completed normally (which
 * advances the expiry properly). It does NOT complete the order itself — that
 * stays a deliberate second step.
 */
export const reopenOrder = async (req, res) => {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { orderNumber } = req.params;
    const { reason } = req.body || {};

    const { data: order, error: fetchError } = await supabaseAdmin
      .from('renewal_orders')
      .select('id, order_number, status')
      .eq('order_number', orderNumber)
      .single();

    if (fetchError || !order) {
      return res.status(404).json({ status: false, message: 'Order not found' });
    }

    if (order.status !== 'cancelled') {
      return res.status(409).json({
        status: false,
        message: `Only cancelled orders can be reopened (this one is ${order.status})`,
      });
    }

    const note = `Reopened${reason ? `: ${reason}` : ''} (was cancelled)`;

    const { error: updateError } = await supabaseAdmin
      .from('renewal_orders')
      .update({
        status: 'pending',
        cancelled_at: null,
        rejection_reason: null,
        processing_notes: note,
        assigned_to: req.admin?.id || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', order.id);

    if (updateError) {
      logError('Reopen order', updateError);
      return response.serverError(res, 'Failed to reopen order');
    }

    logInfo('[Admin] Order reopened', {
      orderNumber,
      adminId: req.admin?.id || null,
      reason: reason || null,
    });

    return response.success(
      res,
      { order_number: orderNumber, status: 'pending' },
      'Order reopened. Set it to Completed to finish the renewal and update the expiry date.'
    );
  } catch (error) {
    logError('Reopen order', error);
    return response.serverError(res, 'Failed to reopen order');
  }
};

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

    // ── Completion: delegate to completeOrder() so driver-license and plate
    // orders (which have no car_id) skip the car-expiry update path. The
    // previous inline implementation called .eq('id', null) on cars, silently
    // matched nothing, and marked the order completed without fulfilling it.
    let updateData = {};
    if (dbStatus === 'completed') {
      try {
        await completeOrder(current.id, req.admin?.id || null, { notes });
      } catch (err) {
        if (err instanceof OrderError) {
          return res.status(err.statusCode || 500).json({ status: false, message: err.message });
        }
        logError('Update order status — completeOrder', err);
        return response.serverError(res, 'Failed to update order status');
      }
    } else {
      updateData = {
        status: dbStatus,
        updated_at: new Date().toISOString(),
      };

      if (dbStatus === 'processing' && current.status === 'pending') {
        updateData.processing_started_at = new Date().toISOString();
        // Auto-assign to the admin performing the action
        updateData.assigned_to = req.admin?.id || null;
        updateData.assigned_at = new Date().toISOString();
      }

      if (dbStatus === 'cancelled') {
        updateData.cancelled_at = new Date().toISOString();
        updateData.rejection_reason = notes || null;
      }

      if (notes && dbStatus !== 'cancelled') {
        updateData.processing_notes = notes;
      }

      const { error: updateError } = await supabaseAdmin
        .from('renewal_orders')
        .update(updateData)
        .eq('order_number', orderNumber);

      if (updateError) {
        logError('Update order status', updateError);
        return response.serverError(res, 'Failed to update order status');
      }
    }

    // Re-fetch with full join so the response and downstream notification
    // code see the same shape as before. completeOrder() returns a thin row;
    // this gives us the same payload the previous single update+select did.
    const { data: updated, error: refetchError } = await supabaseAdmin
      .from('renewal_orders')
      .select(`
        *,
        cars:car_id ( id, slug, vehicle_make, vehicle_model, vehicle_year, vehicle_color,
                      registration_no, chasis_no, engine_no, expiry_date ),
        payment_transactions:transaction_id ( id, reference, amount, status, paid_at, payment_gateway, payment_type, metadata )
      `)
      .eq('order_number', orderNumber)
      .single();

    if (refetchError || !updated) {
      logError('Update order status — refetch', refetchError);
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
            newExpiryDate: updated.new_expiry_date || null,
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
    const { page = 1, per_page = 15, status = 'all', gateway = 'all', search, include_duplicates } = req.query;

    const limit = Math.min(100, Math.max(1, parseInt(per_page)));
    const offset = (Math.max(1, parseInt(page)) - 1) * limit;

    // Map frontend filter 'success' → DB 'successful'
    const dbStatus = status === 'success' ? 'successful'
      : status === 'failed' ? 'failed'
      : status === 'pending' ? 'pending'
      : status === 'abandoned' ? 'abandoned'
      : null;

    const dbGateway = (gateway === 'paystack' || gateway === 'monipay' || gateway === 'monicredit') ? gateway : null;

    // Hide rows tagged as duplicate_init by default — they're noise from users
    // re-initialising payment (gateway switches, rapid retries). Pass
    // ?include_duplicates=true to see everything. Applied to BOTH the list
    // query and the summary aggregates so the cards reflect what's displayed.
    const hideDuplicates = include_duplicates !== 'true' && include_duplicates !== '1';

    let query = supabaseAdmin
      .from('payment_transactions')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (dbStatus) query = query.eq('status', dbStatus);
    if (dbGateway) query = query.eq('payment_gateway', dbGateway);
    if (search) query = query.ilike('reference', `%${search}%`);
    if (hideDuplicates) query = query.or('cancellation_reason.is.null,cancellation_reason.neq.duplicate_init');

    // Summary: HEAD-only count queries (no row transfer) + targeted sums on the
    // smaller `successful` / `pending` subsets. The previous implementation
    // streamed every row in payment_transactions on every page render — fine at
    // a few hundred rows, terrible past a few thousand.
    //
    // NOTE: Supabase JS requires .select() before any filter chain (.eq, etc).
    // Build each query as `from().select(...)` first, then apply filters.
    // Each query also respects the `hideDuplicates` flag so the cards match
    // what's visible in the table — admin sees the same numbers as the rows.
    //
    // These aggregates depend only on the filters, not on the page of rows, so
    // they are kicked off alongside the main query rather than after it. The
    // request used to make three sequential round trips to Supabase (rows →
    // user details → summary); overlapping these two removes one of them.
    const applyDupFilter = (q) =>
      hideDuplicates ? q.or('cancellation_reason.is.null,cancellation_reason.neq.duplicate_init') : q;
    const headCount = (filterFn) => {
      let q = supabaseAdmin.from('payment_transactions').select('id', { count: 'exact', head: true });
      q = applyDupFilter(q);
      if (filterFn) q = filterFn(q);
      return q;
    };
    const sumQuery = (filterFn) => {
      let q = supabaseAdmin.from('payment_transactions').select('amount');
      q = applyDupFilter(q);
      if (filterFn) q = filterFn(q);
      return q;
    };
    const summaryPromise = Promise.all([
      headCount(),
      headCount(q => q.eq('status', 'successful')),
      headCount(q => q.eq('status', 'pending')),
      headCount(q => q.eq('status', 'failed')),
      headCount(q => q.eq('status', 'abandoned')),
      headCount(q => q.eq('payment_gateway', 'paystack')),
      headCount(q => q.eq('payment_gateway', 'monipay')),
      headCount(q => q.eq('payment_gateway', 'monicredit')),
      sumQuery(q => q.eq('status', 'successful')),
      sumQuery(q => q.eq('status', 'pending')),
    ]);

    const { data: transactions, count, error } = await query;
    if (error) {
      logError('List transactions', error);
      // The summary is already in flight — swallow its rejection so an early
      // return here can't surface as an unhandled promise rejection.
      summaryPromise.catch(() => {});
      return res.status(500).json({ status: false, message: 'Failed to retrieve transactions' });
    }

    const userIds = [...new Set((transactions || []).map(t => t.user_id).filter(Boolean))];
    const { profileMap, emailMap } = await fetchUserDetails(supabaseAdmin, userIds);

    const [
      { count: cntTotal },
      { count: cntSuccessful },
      { count: cntPending },
      { count: cntFailed },
      { count: cntAbandoned },
      { count: cntPaystack },
      { count: cntMonipay },
      { count: cntMonicredit },
      { data: successfulAmounts },
      { data: pendingAmounts },
    ] = await summaryPromise;

    const sumKobo = (rows) => (rows || []).reduce((s, r) => s + parseFloat(r.amount || 0), 0);
    const receivedKobo = sumKobo(successfulAmounts);
    const pendingKobo = sumKobo(pendingAmounts);

    const summary = {
      counts: {
        total: cntTotal || 0,
        successful: cntSuccessful || 0,
        pending: cntPending || 0,
        failed: cntFailed || 0,
        abandoned: cntAbandoned || 0,
      },
      amounts: {
        received_kobo: receivedKobo,
        received: koboToNaira(receivedKobo),
        pending_kobo: pendingKobo,
        pending: koboToNaira(pendingKobo),
      },
      by_gateway: {
        paystack: cntPaystack || 0,
        monipay: cntMonipay || 0,
        monicredit: cntMonicredit || 0,
      },
      // Back-compat: old AdminPayments.jsx still reads these field names. Keep
      // returning them so a stale frontend cache doesn't blank the cards.
      total_amount: koboToNaira(receivedKobo),
      total_transactions: cntTotal || 0,
      successful_transactions: cntSuccessful || 0,
      failed_transactions: (cntFailed || 0) + (cntAbandoned || 0),
      pending_transactions: cntPending || 0,
    };

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
    // The `car-documents` Supabase bucket is private, so the stored file_url
    // (a /public/ path) cannot be opened directly — Supabase responds with
    // "Bucket not found". Replace each file_url with a short-lived signed URL
    // before returning. Mirrors the user-facing document.controller flow.
    const documents = await withSignedUrls(result.documents);
    return res.status(200).json({
      status: true,
      message: 'Documents retrieved',
      data: documents,
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
    // Bucket is private — sign the URL so the admin can actually open the file
    const signedUrl = doc.file_url ? await getSignedUrl(doc.file_url).catch(() => null) : null;
    return res.status(200).json({
      status: true,
      message: 'Document retrieved',
      data: { ...doc, file_url: signedUrl, user: profile },
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

    const signedUrl = await getSignedUrl(doc.file_url).catch(() => null);
    return res.status(201).json({
      status: true,
      message: 'Document uploaded successfully',
      data: { document: { ...doc, file_url: signedUrl } },
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

    if (doc?.user_id) {
      (async () => {
        try {
          const supabaseAdmin = getSupabaseAdmin();
          const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('first_name, phone_number')
            .eq('id', doc.user_id)
            .single();

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

          await sendDocumentRejectedWhatsApp({
            phone:       profile?.phone_number || null,
            name:        profile?.first_name   || 'User',
            vehicleName,
            reason:      reason || null,
          });
        } catch (err) {
          logError('WhatsApp document rejected notification failed (non-blocking)', err);
        }
      })();
    }

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

// GET /admin/documents/:id/download — return a short-lived signed URL the
// frontend can open in a new tab. The `car-documents` bucket is private, so
// the stored /public/ URL cannot be opened directly (Supabase returns
// "Bucket not found"). A signed URL is required.
export const downloadDocument = async (req, res) => {
  try {
    const doc = await getDocumentById(parseInt(req.params.id, 10));
    if (!doc) {
      return res.status(404).json({ status: false, message: 'Document not found' });
    }
    if (!doc.file_url) {
      return res.status(404).json({ status: false, message: 'Document has no file attached' });
    }
    let signedUrl;
    try {
      signedUrl = await getSignedUrl(doc.file_url);
    } catch (err) {
      logError('Admin download document — sign URL failed', { docId: doc.id, error: err.message });
      return res.status(500).json({ status: false, message: 'Failed to generate file URL' });
    }
    return res.status(200).json({ status: true, url: signedUrl });
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
  const { reference } = req.params;
  const transaction = await getTransactionByReference(reference).catch(() => null);

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
  const priorStatus = transaction.status;
  // Track what we changed so we can revert on failure. The DB probe found one
  // orphan txn — a payment marked successful by admin where order creation
  // silently failed and left the user with a billed payment but no fulfilment.
  // This guard makes that impossible: any failure past the status flip undoes it.
  let txnFlippedToSuccessfulHere = false;
  const revertTxn = async (reason) => {
    if (!txnFlippedToSuccessfulHere) return;
    try {
      await updateTransactionStatus(reference, {
        status: priorStatus,
        channel: transaction.channel || null,
        authorization_code: null,
        paid_at: transaction.paid_at || null,
      });
      logInfo('[markTransactionPaid] Reverted txn to prior status after failure', { reference, priorStatus, reason });
    } catch (revertErr) {
      // Manual cleanup required — but at least it's audit-logged
      logError('[markTransactionPaid] Revert FAILED — manual cleanup needed', {
        reference, priorStatus, reason, error: revertErr.message
      });
    }
  };

  try {
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
      txnFlippedToSuccessfulHere = true;
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

    if (!finalOrderId) {
      await revertTxn('order creation produced no orderId');
      return res.status(500).json({
        status: false,
        message: 'Failed to create order for transaction. No changes saved — the transaction status is unchanged.'
      });
    }

    const updatedTransaction = await getTransactionByReference(reference);
    const createdOrder = await getOrderById(finalOrderId).catch(() => null);

    try {
      await PaymentSuccessService.processPaymentSuccessSideEffects({
        transaction: updatedTransaction,
        gatewayData: { channel: transaction.channel || 'manual' },
        order: createdOrder,
      });
    } catch (notifyError) {
      // Payment + order are committed; notifications must not block success
      logError('mark-paid: side-effects failed', { error: notifyError.message, reference });
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
    await revertTxn(`exception: ${error.message}`);
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
/**
 * Live broadcasts are off unless ADMIN_BROADCAST_ENABLED=true.
 *
 * On 2026-08-14 a single click sent 109 WhatsApp messages, every one of which
 * failed downstream because the sender is offline — and the API reported success
 * for all of them. Until delivery outcomes are recorded, a live send is a shot in
 * the dark, so the admin UI offers dry runs only and the endpoints refuse the
 * rest. Dry runs are unaffected.
 */
function liveBroadcastBlocked(res, dryRun) {
  if (dryRun || process.env.ADMIN_BROADCAST_ENABLED === 'true') return false;
  return response.error(
    res,
    'Live broadcasts are disabled. Set ADMIN_BROADCAST_ENABLED=true to re-enable once delivery tracking is in place.'
  );
}

export async function broadcastAddCarReminder(req, res) {
  const supabase = getSupabaseAdmin();
  const dryRun = req.query.dry_run === 'true';

  const blocked = liveBroadcastBlocked(res, dryRun);
  if (blocked) return blocked;

  try {
    // Step 1: collect user_ids that already have at least one active car
    const { data: carsData, error: carsError } = await supabase
      .from('cars')
      .select('user_id')
      .is('deleted_at', null);

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

    if (process.env.WHATSAPP_REMINDERS_ENABLED !== 'true') {
      return response.error(
        res,
        'WhatsApp notifications are disabled. Set WHATSAPP_REMINDERS_ENABLED=true to enable.',
        400,
      );
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

// ─── WhatsApp Expiry Reminders ────────────────────────────────────────────────

/**
 * POST /api/admin/notifications/expiry-reminders
 *
 * Sends WhatsApp expiry reminders for cars expiring in 1, 7, 14, or 30 days.
 * Supports ?dry_run=true to preview counts without sending.
 * Supports ?days=7 to target a single window (default: all four windows).
 */
export async function triggerExpiryReminders(req, res) {
  const supabase = getSupabaseAdmin();
  const dryRun = req.query.dry_run === 'true';
  const specificDays = req.query.days ? parseInt(req.query.days) : null;

  const blocked = liveBroadcastBlocked(res, dryRun);
  if (blocked) return blocked;

  try {
    const REMINDER_WINDOWS = specificDays ? [specificDays] : [30, 14, 7, 1];
    const frontendUrl = process.env.FRONTEND_URL || 'https://app.motoka.ng';

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    // Collect results per window
    const results = [];
    let totalAttempted = 0;

    for (const days of REMINDER_WINDOWS) {
      const targetDate = new Date(today);
      targetDate.setDate(targetDate.getDate() + days);
      const targetDateStr = targetDate.toISOString().split('T')[0];

      // Query cars expiring on the target date with user profile
      const { data: cars, error: carsError } = await supabase
        .from('cars')
        .select(`
          id,
          registration_no,
          vehicle_make,
          vehicle_model,
          expiry_date,
          slug,
          profiles!cars_user_id_fkey (
            first_name,
            phone_number,
            user_id
          )
        `)
        .eq('expiry_date', targetDateStr)
        .is('deleted_at', null)
        .eq('status', 'approved')
        .not('profiles.phone_number', 'is', null);

      if (carsError) {
        logError('[ExpiryReminder] Failed to query cars', { days, error: carsError.message });
        results.push({ days, count: 0, error: carsError.message });
        continue;
      }

      const eligible = (cars || []).filter(c => c.profiles?.phone_number);
      results.push({ days, count: eligible.length });

      if (dryRun || eligible.length === 0) continue;

      if (process.env.WHATSAPP_REMINDERS_ENABLED !== 'true') {
        results.push({ days, count: 0, error: 'WhatsApp disabled' });
        continue;
      }

      totalAttempted += eligible.length;

      const BATCH_SIZE = 10;
      const BATCH_DELAY_MS = 1000;

      for (let i = 0; i < eligible.length; i += BATCH_SIZE) {
        const batch = eligible.slice(i, i + BATCH_SIZE);

        await Promise.allSettled(
          batch.map(car =>
            sendExpiryReminderWhatsApp({
              phone: car.profiles.phone_number,
              name: car.profiles.first_name || 'there',
              registrationNo: car.registration_no,
              expiryDate: car.expiry_date,
              daysRemaining: days,
              renewalUrl: `${frontendUrl}/licenses/renew`,
            }),
          ),
        );

        if (i + BATCH_SIZE < eligible.length) {
          await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
        }
      }
    }

    const totalEligible = results.reduce((sum, r) => sum + r.count, 0);

    logInfo('[ExpiryReminder] Trigger complete', { dryRun, totalEligible, totalAttempted, results });

    return response.success(res, {
      dry_run: dryRun,
      windows: results,
      total_eligible: totalEligible,
      total_attempted: dryRun ? 0 : totalAttempted,
      message: dryRun
        ? `Dry run: ${totalEligible} car(s) across ${results.length} window(s) would receive reminders.`
        : `Sent reminders to ${totalAttempted} car(s) across ${results.length} window(s).`,
    });
  } catch (err) {
    logError('[ExpiryReminder] Unexpected error', { error: err.message });
    return response.serverError(res, 'Failed to trigger expiry reminders');
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
      .select('id, guest_name, guest_email, guest_phone, plate_number, payment_status, payment_gateway, total_amount, created_at, linked_user_id, payment_reference, delivery_fee, delivery_details, selected_items', { count: 'exact' })
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

    const delivery = await getDeliveryProgressForGuestOrder(order, { includeLabel: true });
    return response.success(res, { ...order, ...delivery }, 'Guest order retrieved');
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

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN USER CREATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/admin/users
 * Admin creates a new user account and optionally registers their first car
 * in a single request. The Supabase trigger auto-creates the profile row, but
 * we verify/patch it explicitly for reliability.
 *
 * Body: {
 *   email, first_name, last_name, phone_number?,
 *   password?,            // auto-generated if omitted
 *   car?: { plate_number, vehicle_make, vehicle_model, ... }
 * }
 */
export const adminCreateUser = async (req, res) => {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { email, first_name, last_name, phone_number, password, car } = req.body;

    if (!email || !first_name || !last_name) {
      return res.status(400).json({
        status: false,
        message: 'email, first_name, and last_name are required',
      });
    }

    // 1. Create the auth user (trigger will attempt profile insert)
    const tempPassword = password || `Motoka${Math.random().toString(36).slice(2, 10)}!`;
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: {
        first_name,
        last_name,
        phone: phone_number || '',
      },
    });

    if (authError) {
      logError('[Admin] createUser auth error', authError);
      const msg = authError.message?.includes('already been registered')
        ? 'A user with this email already exists'
        : authError.message || 'Failed to create user';
      return res.status(409).json({ status: false, message: msg });
    }

    const userId = authData.user.id;

    // 2. Check if trigger already created the profile
    const { data: existingProfile } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('id', userId)
      .maybeSingle();

    if (!existingProfile) {
      // Generate a unique 6-char short user_id (same logic as auth signup)
      let shortUserId;
      for (let i = 0; i < 10; i++) {
        const candidate = Math.random().toString(36).substring(2, 8).toUpperCase();
        const { data: conflict } = await supabaseAdmin
          .from('profiles').select('id').eq('user_id', candidate).maybeSingle();
        if (!conflict) { shortUserId = candidate; break; }
      }

      const { error: profileError } = await supabaseAdmin
        .from('profiles')
        .insert({
          id: userId,
          user_id: shortUserId,
          first_name,
          last_name,
          phone_number: phone_number || null,
          email,
          user_type_id: 2,
        });

      if (profileError) {
        logError('[Admin] createUser profile insert failed', profileError);
        await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => {});
        return res.status(500).json({ status: false, message: 'Failed to create user profile' });
      }
    }

    // 3. Optionally create the first car
    let createdCar = null;
    if (car && typeof car === 'object' && Object.keys(car).length > 0) {
      try {
        const sanitizedBody = sanitizeCarInput(car);
        const carData = buildCarData(sanitizedBody, userId);
        createdCar = await createCar(supabaseAdmin, carData);
        logInfo('[Admin] Car created with new user', { userId, carSlug: createdCar.slug });
      } catch (carErr) {
        logError('[Admin] createUser car creation failed (non-fatal)', carErr);
        // User was created successfully — car failure shouldn't roll back
        // We'll report the partial success
      }
    }

    // 4. Fetch the complete profile to return
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    logInfo('[Admin] User created', {
      adminId: req.admin?.id,
      userId,
      email,
      hasCar: !!createdCar,
    });

    return res.status(201).json({
      status: true,
      message: createdCar
        ? 'User and car created successfully'
        : 'User created successfully',
      data: {
        user: {
          id: userId,
          user_id: profile?.user_id,
          name: `${first_name} ${last_name}`.trim(),
          email,
          phone: phone_number || null,
          created_at: profile?.created_at,
        },
        car: createdCar || null,
        temporary_password: tempPassword,
      },
    });
  } catch (error) {
    logError('[Admin] adminCreateUser', error);
    return res.status(500).json({ status: false, message: 'Failed to create user' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN CAR CREATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/admin/cars
 * Admin adds a single car on behalf of any existing user.
 * Body: { user_id: UUID, ...car fields }
 */
export const adminAddCar = async (req, res) => {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { user_id, ...carBody } = req.body;

    if (!user_id) {
      return res.status(400).json({ status: false, message: 'user_id is required' });
    }

    // Verify user exists
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, first_name, last_name, email')
      .eq('id', user_id)
      .is('deleted_at', null)
      .single();

    if (profileError || !profile) {
      return res.status(404).json({ status: false, message: 'User not found' });
    }

    const sanitizedBody = sanitizeCarInput(carBody);
    const identifiers = extractNormalizedIdentifiers(sanitizedBody);

    // Validate date ordering
    if (sanitizedBody.date_issued && sanitizedBody.expiry_date) {
      if (new Date(sanitizedBody.expiry_date) <= new Date(sanitizedBody.date_issued)) {
        return res.status(400).json({ status: false, message: 'Expiry date must be after date issued' });
      }
    }

    // Check for duplicate registration/chassis/engine numbers
    if (identifiers.registration_no || identifiers.chasis_no || identifiers.engine_no) {
      const orParts = [];
      if (identifiers.registration_no) orParts.push(`registration_no.eq.${identifiers.registration_no}`);
      if (identifiers.chasis_no) orParts.push(`chasis_no.eq.${identifiers.chasis_no}`);
      if (identifiers.engine_no) orParts.push(`engine_no.eq.${identifiers.engine_no}`);

      const { data: existing } = await supabaseAdmin
        .from('cars')
        .select('id, registration_no, chasis_no, engine_no')
        .or(orParts.join(','))
        .is('deleted_at', null)
        .limit(1);

      if (existing && existing.length > 0) {
        const dup = existing[0];
        const fields = [];
        if (identifiers.registration_no && dup.registration_no === identifiers.registration_no) fields.push('Registration number');
        if (identifiers.chasis_no && dup.chasis_no === identifiers.chasis_no) fields.push('Chassis number');
        if (identifiers.engine_no && dup.engine_no === identifiers.engine_no) fields.push('Engine number');
        return res.status(409).json({ status: false, message: `${fields.join(', ')} already exists in the system` });
      }
    }

    const carData = buildCarData(sanitizedBody, user_id);
    const car = await createCar(supabaseAdmin, carData);

    logInfo('Admin added car', { adminId: req.admin?.id, userId: user_id, carSlug: car.slug });

    return res.status(201).json({
      status: true,
      message: 'Car added successfully',
      data: {
        car,
        owner: {
          id: profile.id,
          name: `${profile.first_name || ''} ${profile.last_name || ''}`.trim(),
          email: profile.email,
        },
      },
    });
  } catch (error) {
    if (error instanceof CarError) {
      return res.status(error.statusCode).json({ status: false, message: error.message });
    }
    logError('adminAddCar', error);
    return res.status(500).json({ status: false, message: 'Failed to add car' });
  }
};

/**
 * PUT /api/admin/cars/:slug
 * Admin updates an existing car's details.
 */
export const adminUpdateCar = async (req, res) => {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { slug } = req.params;

    // Fetch the existing car
    const { data: existingCar, error: fetchError } = await supabaseAdmin
      .from('cars')
      .select('id, slug, registration_no, chasis_no, engine_no')
      .eq('slug', slug)
      .is('deleted_at', null)
      .single();

    if (fetchError || !existingCar) {
      return res.status(404).json({ status: false, message: 'Car not found' });
    }

    const sanitizedBody = sanitizeCarInput(req.body);

    // Validate date ordering if both dates are provided
    if (sanitizedBody.date_issued && sanitizedBody.expiry_date) {
      if (new Date(sanitizedBody.expiry_date) <= new Date(sanitizedBody.date_issued)) {
        return res.status(400).json({ status: false, message: 'Expiry date must be after date issued' });
      }
    }

    // Check for duplicate identifiers, excluding the current car
    const identifiers = extractNormalizedIdentifiers(sanitizedBody);
    if (identifiers.registration_no || identifiers.chasis_no || identifiers.engine_no) {
      const orParts = [];
      if (identifiers.registration_no) orParts.push(`registration_no.eq.${identifiers.registration_no}`);
      if (identifiers.chasis_no) orParts.push(`chasis_no.eq.${identifiers.chasis_no}`);
      if (identifiers.engine_no) orParts.push(`engine_no.eq.${identifiers.engine_no}`);

      const { data: dupCars } = await supabaseAdmin
        .from('cars')
        .select('id, registration_no, chasis_no, engine_no')
        .or(orParts.join(','))
        .neq('id', existingCar.id)
        .is('deleted_at', null)
        .limit(1);

      if (dupCars && dupCars.length > 0) {
        const dup = dupCars[0];
        const fields = [];
        if (identifiers.registration_no && dup.registration_no === identifiers.registration_no) fields.push('Registration number');
        if (identifiers.chasis_no && dup.chasis_no === identifiers.chasis_no) fields.push('Chassis number');
        if (identifiers.engine_no && dup.engine_no === identifiers.engine_no) fields.push('Engine number');
        return res.status(409).json({ status: false, message: `${fields.join(', ')} already exists in the system` });
      }
    }

    const updateData = buildUpdateData(sanitizedBody, existingCar);

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ status: false, message: 'No valid fields to update' });
    }

    const { data: updatedCar, error: updateError } = await supabaseAdmin
      .from('cars')
      .update(updateData)
      .eq('id', existingCar.id)
      .select()
      .single();

    if (updateError) {
      logError('adminUpdateCar DB', updateError);
      return res.status(500).json({ status: false, message: 'Failed to update car' });
    }

    logInfo('Admin updated car', { adminId: req.admin?.id, carSlug: slug });

    return res.status(200).json({
      status: true,
      message: 'Car updated successfully',
      data: updatedCar,
    });
  } catch (error) {
    logError('adminUpdateCar', error);
    return res.status(500).json({ status: false, message: 'Failed to update car' });
  }
};

export const adminDeleteCar = async (req, res) => {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { slug } = req.params;

    const { data: existingCar, error: fetchError } = await supabaseAdmin
      .from('cars')
      .select('id')
      .eq('slug', slug)
      .is('deleted_at', null)
      .single();

    if (fetchError || !existingCar) {
      return res.status(404).json({ status: false, message: 'Car not found' });
    }

    const { error: deleteError } = await supabaseAdmin
      .from('cars')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', existingCar.id);

    if (deleteError) {
      logError('adminDeleteCar DB', deleteError);
      return res.status(500).json({ status: false, message: 'Failed to delete car' });
    }

    logInfo('Admin deleted car', { adminId: req.admin?.id, carSlug: slug });

    return res.status(200).json({ status: true, message: 'Car deleted successfully' });
  } catch (error) {
    logError('adminDeleteCar', error);
    return res.status(500).json({ status: false, message: 'Failed to delete car' });
  }
};

/**
 * POST /api/admin/cars/bulk-import
 * Admin uploads a CSV file to create multiple cars for existing users.
 *
 * CSV columns (header row required):
 *   user_email, name_of_owner, address, phone_number,
 *   vehicle_make, vehicle_model, vehicle_year, vehicle_color,
 *   car_type, registration_status, registration_no, chasis_no,
 *   engine_no, date_issued, expiry_date, plate_number
 *
 * Returns:
 *   { total, succeeded, failed, errors: [{ row, user_email, reason }] }
 */
export const adminBulkImportCars = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ status: false, message: 'CSV file is required' });
  }

  const supabaseAdmin = getSupabaseAdmin();
  const results = { total: 0, succeeded: 0, failed: 0, errors: [], created: [] };

  try {
    const csvText = req.file.buffer.toString('utf-8');

    let rows;
    try {
      rows = csvParse(csvText, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });
    } catch (parseErr) {
      return res.status(400).json({ status: false, message: `Invalid CSV format: ${parseErr.message}` });
    }

    results.total = rows.length;

    if (rows.length === 0) {
      return res.status(400).json({ status: false, message: 'CSV file is empty or has no data rows' });
    }

    if (rows.length > 500) {
      return res.status(400).json({ status: false, message: 'Maximum 500 rows per import' });
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // +2 because row 1 is the header
      const userEmail = (row.user_email || '').trim().toLowerCase();

      try {
        // Validate required fields
        if (!userEmail) throw new Error('user_email is required');
        if (!row.vehicle_make) throw new Error('vehicle_make is required');
        if (!row.vehicle_model) throw new Error('vehicle_model is required');
        if (!row.vehicle_year) throw new Error('vehicle_year is required');
        if (!row.vehicle_color) throw new Error('vehicle_color is required');
        if (!row.car_type) throw new Error('car_type is required (private or commercial)');
        if (!row.registration_status) throw new Error('registration_status is required (registered or unregistered)');
        if (!row.name_of_owner) throw new Error('name_of_owner is required');
        if (!row.address) throw new Error('address is required');

        if (!['private', 'commercial'].includes(row.car_type.toLowerCase())) {
          throw new Error('car_type must be "private" or "commercial"');
        }
        if (!['registered', 'unregistered'].includes(row.registration_status.toLowerCase())) {
          throw new Error('registration_status must be "registered" or "unregistered"');
        }

        const year = parseInt(row.vehicle_year, 10);
        if (isNaN(year) || year < 1900 || year > new Date().getFullYear() + 1) {
          throw new Error(`vehicle_year must be a valid year between 1900 and ${new Date().getFullYear() + 1}`);
        }

        // Look up user by email in profiles table
        const { data: profile, error: profileErr } = await supabaseAdmin
          .from('profiles')
          .select('id, first_name, last_name, email')
          .eq('email', userEmail)
          .is('deleted_at', null)
          .maybeSingle();

        if (profileErr) throw new Error('Database error looking up user');
        if (!profile) throw new Error(`No user found with email "${userEmail}"`);

        const carBody = {
          name_of_owner: row.name_of_owner,
          address: row.address,
          phone_number: row.phone_number || null,
          vehicle_make: row.vehicle_make,
          vehicle_model: row.vehicle_model,
          vehicle_year: year,
          vehicle_color: row.vehicle_color,
          car_type: row.car_type.toLowerCase(),
          registration_status: row.registration_status.toLowerCase(),
          registration_no: row.registration_no || null,
          chasis_no: row.chasis_no || null,
          engine_no: row.engine_no || null,
          date_issued: row.date_issued || null,
          expiry_date: row.expiry_date || null,
          plate_number: row.plate_number || null,
        };

        const sanitizedBody = sanitizeCarInput(carBody);
        const identifiers = extractNormalizedIdentifiers(sanitizedBody);

        // Date ordering validation
        if (sanitizedBody.date_issued && sanitizedBody.expiry_date) {
          if (new Date(sanitizedBody.expiry_date) <= new Date(sanitizedBody.date_issued)) {
            throw new Error('Expiry date must be after date issued');
          }
        }

        // Duplicate check for this row
        if (identifiers.registration_no || identifiers.chasis_no || identifiers.engine_no) {
          const orParts = [];
          if (identifiers.registration_no) orParts.push(`registration_no.eq.${identifiers.registration_no}`);
          if (identifiers.chasis_no) orParts.push(`chasis_no.eq.${identifiers.chasis_no}`);
          if (identifiers.engine_no) orParts.push(`engine_no.eq.${identifiers.engine_no}`);

          const { data: existing } = await supabaseAdmin
            .from('cars')
            .select('id, registration_no, chasis_no, engine_no')
            .or(orParts.join(','))
            .is('deleted_at', null)
            .limit(1);

          if (existing && existing.length > 0) {
            const dup = existing[0];
            const fields = [];
            if (identifiers.registration_no && dup.registration_no === identifiers.registration_no) fields.push('registration number');
            if (identifiers.chasis_no && dup.chasis_no === identifiers.chasis_no) fields.push('chassis number');
            if (identifiers.engine_no && dup.engine_no === identifiers.engine_no) fields.push('engine number');
            throw new Error(`Duplicate ${fields.join(', ')} already exists`);
          }
        }

        const carData = buildCarData(sanitizedBody, profile.id);
        const car = await createCar(supabaseAdmin, carData);

        results.succeeded++;
        results.created.push({
          row: rowNum,
          user_email: userEmail,
          car_slug: car.slug,
          vehicle: `${car.vehicle_make} ${car.vehicle_model} (${car.vehicle_year})`,
        });
      } catch (rowErr) {
        results.failed++;
        results.errors.push({
          row: rowNum,
          user_email: userEmail || row.user_email || '(empty)',
          reason: rowErr.message,
        });
      }
    }

    logInfo('Admin bulk import cars', {
      adminId: req.admin?.id,
      total: results.total,
      succeeded: results.succeeded,
      failed: results.failed,
    });

    return res.status(200).json({
      status: true,
      message: `Import complete: ${results.succeeded} added, ${results.failed} failed`,
      data: results,
    });
  } catch (error) {
    logError('adminBulkImportCars', error);
    return res.status(500).json({ status: false, message: 'Bulk import failed' });
  }
};

// ─── Vehicle Document (Renewal Item) Pricing ─────────────────────────────────

/**
 * GET /api/admin/vehicle-doc-prices
 * Returns all renewal items (including inactive) so admin can manage them.
 */
export const getRenewalItemPrices = async (req, res) => {
  try {
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from('renewal_items')
      .select('item_key, name, price, required, active')
      .order('required', { ascending: false })
      .order('name', { ascending: true });

    if (error) {
      logError('[Admin] getRenewalItemPrices error', error);
      return response.serverError(res, 'Failed to retrieve renewal item prices');
    }

    return response.success(res, data || [], 'Renewal item prices retrieved');
  } catch (err) {
    logError('[Admin] getRenewalItemPrices error', err);
    return response.serverError(res, 'Failed to retrieve renewal item prices');
  }
};

/**
 * PUT /api/admin/vehicle-doc-prices/:itemKey
 * Update the price (and optionally name/active) of a renewal item.
 * Price is stored in kobo so we accept kobo directly.
 */
export const updateRenewalItemPrice = async (req, res) => {
  try {
    const { itemKey } = req.params;
    const { price, name, active } = req.body;
    const supabase = getSupabaseAdmin();

    if (price === undefined && name === undefined && active === undefined) {
      return res.status(400).json({ status: false, message: 'At least one of price, name, or active must be provided' });
    }

    if (price !== undefined) {
      const parsed = Number(price);
      if (!Number.isInteger(parsed) || parsed < 0) {
        return res.status(400).json({ status: false, message: 'price must be a non-negative integer (in kobo)' });
      }
    }

    // Verify the item exists
    const { data: existing, error: fetchErr } = await supabase
      .from('renewal_items')
      .select('item_key, name, price, required, active')
      .eq('item_key', itemKey)
      .maybeSingle();

    if (fetchErr || !existing) {
      return res.status(404).json({ status: false, message: 'Renewal item not found' });
    }

    const updatePayload = { updated_at: new Date().toISOString() };
    if (price !== undefined) updatePayload.price = Number(price);
    if (name !== undefined) updatePayload.name = String(name).trim();
    if (active !== undefined) updatePayload.active = Boolean(active);

    const { data: updated, error: updateErr } = await supabase
      .from('renewal_items')
      .update(updatePayload)
      .eq('item_key', itemKey)
      .select('item_key, name, price, required, active')
      .single();

    if (updateErr) {
      logError('[Admin] updateRenewalItemPrice update error', updateErr);
      return response.serverError(res, 'Failed to update renewal item price');
    }

    logInfo('[Admin] Renewal item price updated', {
      itemKey,
      previousPrice: existing.price,
      newPrice: updated.price,
      adminId: req.admin?.id,
    });

    return response.success(res, updated, 'Renewal item price updated successfully');
  } catch (err) {
    logError('[Admin] updateRenewalItemPrice error', err);
    return response.serverError(res, 'Failed to update renewal item price');
  }
};
