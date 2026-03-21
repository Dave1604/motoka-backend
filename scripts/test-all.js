/**
 * MOTOKA FULL TEST SUITE
 * Tests: Twilio WhatsApp (all 4 templates), Guest Renewal flow, Admin endpoints
 *
 * Run: node scripts/test-all.js
 */

import 'dotenv/config';
import jwt from 'jsonwebtoken';
import {
  sendExpiryReminderWhatsApp,
  sendOrderUpdateWhatsApp,
  sendDocumentReadyWhatsApp,
  sendAddCarReminderWhatsApp,
} from '../src/services/whatsapp/whatsapp.service.js';

const BASE = 'http://localhost:3000/api';
const TEST_PHONE = '09019174288';

// ─── Helpers ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function ok(label) {
  console.log(`  ✅ ${label}`);
  passed++;
}

function fail(label, detail) {
  console.log(`  ❌ ${label}`);
  if (detail) console.log(`     ${String(detail).slice(0, 200)}`);
  failed++;
}

async function api(method, path, body, headers = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { _raw: text }; }
  return { status: res.status, body: json };
}

function makeAdminToken() {
  return jwt.sign(
    { id: '0b80ae3f-56ca-4a42-90d6-9d01d23da192', email: 'rasak@motokaapp.ng', is_admin: true, type: 'admin' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

// ─── 1. Twilio WhatsApp ────────────────────────────────────────────────────────

async function testTwilio() {
  console.log('\n━━━ 1. Twilio WhatsApp ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const phone = TEST_PHONE;
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5174';

  try {
    await sendExpiryReminderWhatsApp({
      phone,
      name:           'Test User',
      registrationNo: 'AAS-123-XY',
      expiryDate:     '2026-04-01',
      daysRemaining:  11,
      renewalUrl:     `${frontendUrl}/licenses/renew`,
    });
    ok('motoka_expiry_reminder sent');
  } catch (e) { fail('motoka_expiry_reminder', e.message); }

  try {
    await sendOrderUpdateWhatsApp({
      phone,
      name:    'Test User',
      orderId: 'ORD-TEST-001',
      status:  'completed',
    });
    ok('motoka_order_update sent');
  } catch (e) { fail('motoka_order_update', e.message); }

  try {
    await sendDocumentReadyWhatsApp({
      phone,
      name:        'Test User',
      vehicleName: '2022 Toyota Corolla',
      documentUrl: `${frontendUrl}/documents/download`,
    });
    ok('motoka_document_ready sent');
  } catch (e) { fail('motoka_document_ready', e.message); }

  try {
    await sendAddCarReminderWhatsApp({
      phone,
      name:   'Test User',
      appUrl: `${frontendUrl}/dashboard`,
    });
    ok('motoka_add_car_reminder sent');
  } catch (e) { fail('motoka_add_car_reminder', e.message); }
}

// ─── 2. Guest Renewal ─────────────────────────────────────────────────────────

async function testGuest() {
  console.log('\n━━━ 2. Guest Renewal ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // 2a. Get public renewal items
  const itemsRes = await api('GET', '/public/renewal-items');
  if (itemsRes.status === 200 && Array.isArray(itemsRes.body?.data)) {
    ok(`GET /public/renewal-items → ${itemsRes.body.data.length} items`);
  } else {
    fail('GET /public/renewal-items', `status ${itemsRes.status}`);
  }

  // 2b. Get states
  const statesRes = await api('GET', '/public/states');
  if (statesRes.status === 200) {
    ok('GET /public/states');
  } else {
    fail('GET /public/states', `status ${statesRes.status}`);
  }

  // 2c. Initiate guest renewal (Monicredit, small items)
  const initRes = await api('POST', '/guest/renewals', {
    name:             'Test Guest',
    email:            'testguest@example.com',
    phone:            TEST_PHONE,
    plate_number:     'TST-000-XX',
    expiry_date:      '2025-12-31',
    selected_items:   ['vehicle_licence', 'insurance'],
    wants_delivery:   false,
    payment_gateway:  'monicredit',
  });

  let orderId, reference;
  if ((initRes.status === 200 || initRes.status === 201) && initRes.body?.data?.orderId) {
    orderId   = initRes.body.data.orderId;
    reference = initRes.body.data.paymentReference;
    ok(`POST /guest/renewals → orderId ${orderId.slice(0, 8)}… ref ${reference}`);
  } else {
    fail('POST /guest/renewals', JSON.stringify(initRes.body).slice(0, 200));
    return; // rest of guest tests depend on this
  }

  // 2d. Poll order status
  const statusRes = await api('GET', `/guest/renewals/${orderId}/status`);
  if (statusRes.status === 200 && statusRes.body?.data?.paymentStatus) {
    ok(`GET /guest/renewals/:id/status → ${statusRes.body.data.paymentStatus}`);
  } else {
    fail('GET /guest/renewals/:id/status', `status ${statusRes.status} body: ${JSON.stringify(statusRes.body).slice(0,120)}`);
  }

  // 2e. Verify (should return pending since we haven't paid)
  const verifyRes = await api('POST', `/guest/renewals/${orderId}/verify`, { reference });
  if (verifyRes.status === 200 || verifyRes.status === 402) {
    ok(`POST /guest/renewals/:id/verify → ${verifyRes.body?.data?.status || verifyRes.status}`);
  } else {
    fail('POST /guest/renewals/:id/verify', `status ${verifyRes.status} ${JSON.stringify(verifyRes.body)}`);
  }

  // 2f. Receipt should return 404/403 since not paid
  const receiptRes = await api('GET', `/guest/renewals/${orderId}/receipt?token=fakebadtoken`);
  if (receiptRes.status === 404 || receiptRes.status === 403) {
    ok('GET /guest/renewals/:id/receipt rejects invalid token correctly');
  } else {
    fail('GET /guest/renewals/:id/receipt token guard', `status ${receiptRes.status}`);
  }
}

// ─── 3. Admin endpoints ───────────────────────────────────────────────────────

async function testAdmin() {
  console.log('\n━━━ 3. Admin Endpoints ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const token = makeAdminToken();
  const auth  = { Authorization: `Bearer ${token}` };

  // Dashboard stats
  const statsRes = await api('GET', '/admin/dashboard/stats', null, auth);
  if (statsRes.status === 200) {
    ok('GET /admin/dashboard/stats');
  } else {
    fail('GET /admin/dashboard/stats', `${statsRes.status} ${JSON.stringify(statsRes.body).slice(0,100)}`);
  }

  // List orders
  const ordersRes = await api('GET', '/admin/orders?page=1&limit=5', null, auth);
  if (ordersRes.status === 200) {
    ok(`GET /admin/orders → ${ordersRes.body?.data?.orders?.length ?? '?'} orders`);
  } else {
    fail('GET /admin/orders', `${ordersRes.status}`);
  }

  // Guest orders (new endpoint)
  const guestOrdersRes = await api('GET', '/admin/guest-orders?page=1&limit=5', null, auth);
  if (guestOrdersRes.status === 200) {
    ok(`GET /admin/guest-orders → ${guestOrdersRes.body?.data?.orders?.length ?? 0} guest orders`);
  } else {
    fail('GET /admin/guest-orders', `${guestOrdersRes.status} ${JSON.stringify(guestOrdersRes.body).slice(0,100)}`);
  }

  // Recent transactions
  const txRes = await api('GET', '/admin/recent-transactions', null, auth);
  if (txRes.status === 200) {
    ok('GET /admin/recent-transactions');
  } else {
    fail('GET /admin/recent-transactions', `${txRes.status}`);
  }

  // Unauthenticated request should be rejected
  const unauthRes = await api('GET', '/admin/dashboard/stats');
  if (unauthRes.status === 401) {
    ok('Admin auth guard rejects unauthenticated requests');
  } else {
    fail('Admin auth guard', `expected 401, got ${unauthRes.status}`);
  }
}

// ─── 4. Core public routes ────────────────────────────────────────────────────

async function testPublic() {
  console.log('\n━━━ 4. Core Public Routes ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const healthRes = await api('GET', '/../health');
  const h2 = await fetch('http://localhost:3000/health');
  if (h2.status === 200) { ok('GET /health'); } else { fail('GET /health', h2.status); }

  const statesRes = await api('GET', '/public/states');
  if (statesRes.status === 200) { ok('GET /public/states'); } else { fail('GET /public/states'); }
}

// ─── Runner ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  MOTOKA TEST SUITE');
  console.log('═══════════════════════════════════════════════════════');

  await testTwilio();
  await testGuest();
  await testAdmin();
  await testPublic();

  console.log('\n═══════════════════════════════════════════════════════');
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════════════════════\n');

  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error('Test runner crashed:', e); process.exit(1); });
