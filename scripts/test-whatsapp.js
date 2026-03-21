/**
 * Manual WhatsApp sandbox test script
 *
 * Usage:
 *   node scripts/test-whatsapp.js
 *
 * Sends one WhatsApp message per flow to the hardcoded test number.
 * Requires WHATSAPP_REMINDERS_ENABLED=true and valid Twilio credentials in .env
 *
 * Safe to run at any time — has zero impact on the database or email system.
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

// ─── Config ───────────────────────────────────────────────────────────────────
const TEST_PHONE  = '+2348128685978';  // Change to your joined sandbox number

// Use PAYMENT_CANCEL_URL which already points to the correct renewal page,
// e.g. http://localhost:5173/licenses/renew
const RENEWAL_URL =
  process.env.PAYMENT_CANCEL_URL ||
  `${process.env.FRONTEND_URL || 'http://localhost:5173'}/licenses/renew`;

// ─── Validate env before importing service ────────────────────────────────────
const required = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_FROM'];
const missing  = required.filter(k => !process.env[k]);

if (missing.length) {
  console.error('\n❌  Missing env vars:', missing.join(', '));
  console.error('   Fill them in .env and re-run.\n');
  process.exit(1);
}

if (process.env.WHATSAPP_REMINDERS_ENABLED !== 'true') {
  console.error('\n❌  WHATSAPP_REMINDERS_ENABLED is not "true" — set it in .env and re-run.\n');
  process.exit(1);
}

// ─── Import service (after env is loaded) ────────────────────────────────────
const {
  sendExpiryReminderWhatsApp,
  sendOrderUpdateWhatsApp,
  sendDocumentReadyWhatsApp,
} = await import('../src/services/whatsapp/whatsapp.service.js');

// ─── Run tests ────────────────────────────────────────────────────────────────
console.log('\n🚀  Motoka WhatsApp sandbox test');
console.log('   From :', process.env.TWILIO_WHATSAPP_FROM);
console.log('   To   :', TEST_PHONE);
console.log('   Env  : sandbox =', process.env.WHATSAPP_SANDBOX_MODE !== 'false');
console.log('');

async function runTest(label, fn) {
  process.stdout.write(`   ⏳  ${label} ... `);
  try {
    await fn();
    console.log('✅  sent');
  } catch (err) {
    console.log('❌  FAILED');
    console.error('       ', err.message);
  }
}

// Test 1 — Expiry reminder
await runTest('Expiry reminder', () =>
  sendExpiryReminderWhatsApp({
    phone:          TEST_PHONE,
    name:           'Test User',
    registrationNo: 'ABC-123-XY',
    expiryDate:     '2026-03-17',
    daysRemaining:  7,
    renewalUrl:     RENEWAL_URL,
  })
);

// Small delay between messages to avoid Twilio rate limits
await new Promise(r => setTimeout(r, 1500));

// Test 2 — Order update
await runTest('Order update', () =>
  sendOrderUpdateWhatsApp({
    phone:   TEST_PHONE,
    name:    'Test User',
    orderId: 'ORD-TEST-001',
    status:  'completed',
  })
);

await new Promise(r => setTimeout(r, 1500));

// Test 3 — Document ready
await runTest('Document ready', () =>
  sendDocumentReadyWhatsApp({
    phone:       TEST_PHONE,
    name:        'Test User',
    vehicleName: '2020 Toyota Camry',
    documentUrl: 'https://motoka.ng/docs/test-doc.pdf',
  })
);

console.log('\n✅  All tests done. Check your WhatsApp and the backend logs.\n');
