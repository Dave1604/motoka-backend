import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { getCarDocuments, getDriverLicenseDocuments, adminListDocuments, getDocumentById } from '../src/services/document.service.js';
import { getSignedUrl, withSignedUrls } from '../src/services/fileUpload.service.js';

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Pick a user + car that has documents so we can exercise both rejected-filter
// and signed-URL paths against real production-shaped rows.
const { data: sample } = await supa
  .from('documents')
  .select('user_id, car_id')
  .not('car_id', 'is', null)
  .limit(1);

if (!sample?.length) {
  console.log('No documents to test against.');
  process.exit(0);
}

const { user_id: userId, car_id: carId } = sample[0];
console.log(`Testing with user_id=${userId.slice(0,8)}… car_id=${carId}`);
console.log();

// ── Test 1: rejected-doc filter, user-facing path ─────────────────────────
console.log('── Bug 2: rejected docs hidden from users ──');
const { count: allDocsForCar } = await supa
  .from('documents')
  .select('id', { count: 'exact', head: true })
  .eq('user_id', userId).eq('car_id', carId).eq('document_type', 'car');
const { count: rejectedDocsForCar } = await supa
  .from('documents')
  .select('id', { count: 'exact', head: true })
  .eq('user_id', userId).eq('car_id', carId).eq('document_type', 'car').eq('status', 'rejected');
const userVisible = await getCarDocuments(userId, carId);
console.log(`  Raw count for this car        : ${allDocsForCar}`);
console.log(`  Rejected count for this car   : ${rejectedDocsForCar}`);
console.log(`  Returned by getCarDocuments() : ${userVisible.length}`);
console.log(`  Hidden                        : ${allDocsForCar - userVisible.length}`);
const hasRejected = userVisible.some(d => d.status === 'rejected');
console.log(`  Any rejected in result?       : ${hasRejected ? '✗ BUG' : '✓ correctly excluded'}`);
console.log();

// ── Test 2: signed URL path, user-facing list ─────────────────────────────
console.log('── User list: file_url replaced with signed URL ──');
const signedUserDocs = await withSignedUrls(userVisible);
const allSignedUser = signedUserDocs.every(d => !d.file_url || d.file_url.includes('/storage/v1/object/sign/'));
console.log(`  All signed?                   : ${allSignedUser ? '✓' : '✗ some raw URLs leaked'}`);
if (signedUserDocs[0]?.file_url) {
  const probe = await fetch(signedUserDocs[0].file_url, { method: 'HEAD' });
  console.log(`  HEAD signed URL response      : ${probe.status} ${probe.headers.get('content-type') || ''}`);
}
console.log();

// ── Test 3: admin list returns ALL statuses + signed ──────────────────────
console.log('── Bug 1: admin endpoints sign URLs + see all statuses ──');
const { documents: adminDocs } = await adminListDocuments({ userId, carId, page: 1, limit: 20 });
const signedAdminDocs = await withSignedUrls(adminDocs);
console.log(`  adminListDocuments count      : ${adminDocs.length}`);
const adminSeesRejected = adminDocs.some(d => d.status === 'rejected');
console.log(`  Admin sees rejected?          : ${adminSeesRejected ? '✓ yes (by design)' : '— none in this set'}`);
const allSignedAdmin = signedAdminDocs.every(d => !d.file_url || d.file_url.includes('/storage/v1/object/sign/'));
console.log(`  All admin URLs signed?        : ${allSignedAdmin ? '✓' : '✗ some raw URLs leaked'}`);
if (signedAdminDocs[0]?.file_url) {
  const probe = await fetch(signedAdminDocs[0].file_url, { method: 'HEAD' });
  console.log(`  HEAD signed URL response      : ${probe.status} ${probe.headers.get('content-type') || ''}`);
}
console.log();

// ── Test 4: admin "View Document" single endpoint sign path ───────────────
console.log('── Admin download endpoint sign path ──');
const oneDoc = await getDocumentById(adminDocs[0].id);
const signed = await getSignedUrl(oneDoc.file_url);
const result = await fetch(signed, { method: 'HEAD' });
console.log(`  Doc id ${oneDoc.id}, status ${oneDoc.status}, signed URL HEAD → ${result.status} ${result.headers.get('content-type') || ''}`);
console.log(`  ${result.status === 200 ? '✓ Admin "View Document" will work.' : '✗ Still broken'}`);

process.exit(0);
