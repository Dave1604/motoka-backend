import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

const BASE_URL = 'https://autofactorng.com';

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'user-agent': 'MotokaLadipoImporter/1.0 (+https://motoka.ng)',
      accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!res.ok) throw new Error(`Fetch failed ${res.status}: ${url}`);
  return res.text();
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      'user-agent': 'MotokaLadipoImporter/1.0 (+https://motoka.ng)',
      accept: 'application/json, text/plain, */*',
      'x-requested-with': 'XMLHttpRequest',
    },
  });
  if (!res.ok) return null;
  try { return await res.json(); } catch { return null; }
}

const homeHtml = await fetchHtml(BASE_URL);
const regex = /href="(\/products\/[^"#?]+)"/gi;
const links = new Set();
let m;
while ((m = regex.exec(homeHtml)) !== null) links.add(`${BASE_URL}${m[1]}`);

console.log(`\nFound ${links.size} category links on homepage:\n`);
for (const url of [...links]) {
  const slug = new URL(url).pathname.split('/').filter(Boolean)[1];
  const payload = await fetchJson(url);
  const total = payload?.meta?.total ?? '?';
  const lastPage = payload?.meta?.last_page ?? '?';
  const sampleProduct = payload?.data?.[0];
  const hasImage = !!(sampleProduct?.image_l || sampleProduct?.image_to_show || sampleProduct?.image_m);
  const hasPrice = !!(sampleProduct?.price);
  console.log(`  ${slug.padEnd(50)} total=${String(total).padStart(5)}  pages=${lastPage}  img=${hasImage}  price=${hasPrice}`);
}
