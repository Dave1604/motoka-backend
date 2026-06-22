import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

console.log('Supabase URL:', process.env.SUPABASE_URL);
console.log();

// 1. List all buckets that actually exist
const { data: buckets, error } = await supa.storage.listBuckets();
if (error) {
  console.error('listBuckets error:', error.message);
  process.exit(1);
}
console.log('━━━ Buckets in this Supabase project ━━━');
if (buckets.length === 0) {
  console.log('  (no buckets configured)');
} else {
  for (const b of buckets) {
    console.log(`  - ${b.name}  (id: ${b.id}, public: ${b.public}, created: ${b.created_at?.slice(0,10)})`);
  }
}

// 2. Look at a few document rows to see what file_url paths look like.
//    Helps us understand whether the bucket prefix in file_url matches an existing bucket.
console.log('\n━━━ Sample documents from car_documents table ━━━');
const { data: docs } = await supa
  .from('car_documents')
  .select('id, document_category, file_url, status, created_at')
  .order('created_at', { ascending: false })
  .limit(5);
if (!docs || docs.length === 0) {
  console.log('  (no documents found)');
} else {
  for (const d of docs) {
    console.log(`  - ${String(d.id).padStart(6)} ${d.document_category?.padEnd(22)} status=${d.status?.padEnd(9)} url=${(d.file_url || '').slice(0, 90)}${d.file_url?.length > 90 ? '…' : ''}`);
  }
}

// 3. Probe the most likely bucket names code might be looking for
console.log('\n━━━ Probing likely bucket names for existence ━━━');
const candidates = ['car-documents', 'car_documents', 'cars-documents', 'documents', 'motoka-documents'];
for (const name of candidates) {
  const r = await supa.storage.from(name).list('', { limit: 1 });
  if (r.error) {
    console.log(`  ${name.padEnd(20)} → ✗ ${r.error.message}`);
  } else {
    console.log(`  ${name.padEnd(20)} → ✓ EXISTS  (${r.data?.length || 0} sample entries)`);
  }
}

process.exit(0);
