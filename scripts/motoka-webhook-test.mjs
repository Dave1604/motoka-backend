import 'dotenv/config';
import crypto from 'crypto';

const SECRET = process.env.MONICREDIT_WEBHOOK_SECRET;
if (!SECRET) {
  console.error('MONICREDIT_WEBHOOK_SECRET not set in .env');
  process.exit(1);
}

// Fake order_id ensures the handler will reach signature verification + the
// "transaction not found" log path, but cannot write anything to the DB.
const fakeOrderId = `WEBHOOK-TEST-${Date.now()}`;

// Use the event-keyed shape; handler also accepts flat shape (see
// webhook.controller.js:97-98). If Monicredit sends a different shape than
// what we assume, the only thing that fails is downstream parsing — signature
// verification still proves the wire works.
const payload = {
  event: 'payment.success',
  data: {
    order_id: fakeOrderId,
    transid: `TEST-TRANS-${Date.now()}`,
    amount: 34055,
    channel: 'TRANSFER',
    date_paid: new Date().toISOString().replace('T', ' ').slice(0, 19),
    status: 'approved'
  }
};

const rawBody = JSON.stringify(payload);
const signature = crypto.createHmac('sha256', SECRET).update(rawBody).digest('hex');

console.log('━━━ Webhook test ━━━');
console.log(`Fake order_id : ${fakeOrderId}`);
console.log(`Body length   : ${rawBody.length} bytes`);
console.log(`Signature     : ${signature.slice(0, 16)}…${signature.slice(-8)} (HMAC-SHA256 hex)`);
console.log('');

async function fire(label, url) {
  console.log(`── ${label} ──`);
  console.log(`POST ${url}`);
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-monicredit-signature': signature
      },
      body: rawBody
    });
    const elapsed = Date.now() - start;
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = text; }
    console.log(`Status   : ${res.status} (${elapsed}ms)`);
    console.log(`Response : ${typeof json === 'object' ? JSON.stringify(json) : json}`);

    if (res.status === 200) {
      console.log('✓ Wire OK — endpoint accepted the signed request.');
    } else if (res.status === 401) {
      console.log('✗ Signature rejected — secret mismatch between sender and server env.');
    } else if (res.status === 400) {
      console.log('✗ 400 — payload shape issue, or missing raw-body parsing.');
    } else {
      console.log(`✗ Unexpected status — check server logs.`);
    }
  } catch (err) {
    console.log(`✗ Request failed: ${err.message}`);
  }
  console.log('');
}

const args = process.argv.slice(2);
const target = args[0] || 'local';

if (target === 'local' || target === 'both') {
  await fire('LOCAL', 'http://localhost:3000/api/webhooks/monicredit');
}
if (target === 'prod' || target === 'both') {
  await fire('PROD',  'https://motoka-backend-g48s.onrender.com/api/webhooks/monicredit');
}

console.log('Next: tail the corresponding backend log and look for:');
console.log('  [Monicredit Webhook] Signature verified');
console.log(`  Transaction not found for Monicredit webhook  { orderId: '${fakeOrderId}' }`);
console.log('Both lines = wire is healthy (the second is expected — we used a fake order_id).');
process.exit(0);
