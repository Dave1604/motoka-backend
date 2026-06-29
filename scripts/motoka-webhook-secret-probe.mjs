import 'dotenv/config';
import crypto from 'crypto';

// Test which secret Render's runtime is actually using by signing the same
// payload with multiple candidates and recording which one prod accepts.
const candidates = [
  { label: 'Latest generated (48 chars, alphanumeric)', value: '42dfFapz4Qi4E5EbaLi1Rv2ta83evuXCsjjTekCnmfHi7juj' },
  { label: 'Previous Render value (43 chars)',          value: 'Wk9xR2mN7pLqJvB4nHcTfY3sA8dE6gU1iK0oP5rX2wZ' },
  { label: 'Original local .env (64-char hex)',         value: 'b2c6694ac0f758b9ba36665f7560d5903a9321b2db6df5a8256529ac7f65081c' },
];

const payload = {
  event: 'payment.success',
  data: {
    order_id: `WEBHOOK-PROBE-${Date.now()}`,
    transid: `PROBE-${Date.now()}`,
    amount: 34055,
    channel: 'TRANSFER',
    date_paid: new Date().toISOString().replace('T', ' ').slice(0, 19),
    status: 'approved'
  }
};
const rawBody = JSON.stringify(payload);

const PROD_URL = 'https://motoka-backend-g48s.onrender.com/api/webhooks/monicredit';

console.log('Probing which secret Render is actually using.\n');

for (const { label, value } of candidates) {
  const sig = crypto.createHmac('sha256', value).update(rawBody).digest('hex');
  process.stdout.write(`  Trying secret: ${label.padEnd(45)} → `);
  const start = Date.now();
  const res = await fetch(PROD_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-monicredit-signature': sig },
    body: rawBody
  });
  const elapsed = Date.now() - start;
  if (res.status === 200) {
    console.log(`✓ 200 — THIS IS THE ONE (${elapsed}ms)`);
  } else if (res.status === 401) {
    console.log(`✗ 401 (${elapsed}ms)`);
  } else {
    console.log(`? ${res.status} (${elapsed}ms)`);
  }
}

console.log('\nIf none returned 200, Render is running with a secret we have NOT tested.');
console.log('Could be: leftover whitespace, a fourth value we forgot, or env-var not loading.');
