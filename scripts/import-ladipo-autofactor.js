import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getSupabaseAdmin } from '../src/config/supabase.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '..', '.env') });

const BASE_URL = 'https://autofactorng.com';
const DEFAULT_LIMIT = 5000;
const DEFAULT_MAX_PAGES = 60;
const DEFAULT_PER_CATEGORY_LIMIT = 300;

function parseArgs(argv) {
  const options = {
    limit: DEFAULT_LIMIT,
    maxPages: DEFAULT_MAX_PAGES,
    perCategoryLimit: DEFAULT_PER_CATEGORY_LIMIT,
    dryRun: false,
    sync: false,
    sellerLabel: 'Ladipo Market',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--limit' && next) {
      options.limit = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === '--max-pages' && next) {
      options.maxPages = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === '--per-category' && next) {
      options.perCategoryLimit = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === '--seller' && next) {
      options.sellerLabel = String(next);
      i += 1;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--sync') {
      options.sync = true;
    }
  }

  if (!Number.isInteger(options.limit) || options.limit < 1) {
    throw new Error('--limit must be a positive integer');
  }
  if (!Number.isInteger(options.maxPages) || options.maxPages < 1) {
    throw new Error('--max-pages must be a positive integer');
  }
  if (!Number.isInteger(options.perCategoryLimit) || options.perCategoryLimit < 1) {
    throw new Error('--per-category must be a positive integer');
  }
  return options;
}

function normalizeSpace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function stripHtml(value) {
  return normalizeSpace(String(value || '').replace(/<[^>]+>/g, ' '));
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function absUrl(path) {
  if (!path) return null;
  if (String(path).startsWith('http://') || String(path).startsWith('https://')) return path;
  if (String(path).startsWith('/')) return `${BASE_URL}${path}`;
  return `${BASE_URL}/${path}`;
}

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
  if (!res.ok) throw new Error(`JSON fetch failed ${res.status}: ${url}`);
  return res.json();
}

function extractHrefMatches(html, regex) {
  const out = [];
  let match;
  while ((match = regex.exec(html)) !== null) {
    out.push(match[1]);
  }
  return out;
}

function extractCategoryLinks(homeHtml) {
  const links = extractHrefMatches(homeHtml, /href="(\/products\/[^"#?]+)"/gi);
  return [...new Set(links.map((p) => absUrl(p)))];
}

function extractProductLinks(html) {
  const links = extractHrefMatches(html, /href="(\/product\/[^"#?]+)"/gi);
  return [...new Set(links.map((p) => absUrl(p)))];
}

function extractMeta(html, property) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i');
  const match = html.match(re);
  return match ? normalizeSpace(match[1]) : null;
}

function extractTitle(html) {
  const ogTitle = extractMeta(html, 'og:title');
  if (ogTitle) {
    const cleanedOg = normalizeSpace(
      ogTitle
        .replace(/^Shop\s*-\s*/i, '')
        .replace(/\s*AutofactorNG\s*$/i, '')
    );
    if (cleanedOg && cleanedOg.toLowerCase() !== 'shop all') return cleanedOg;
  }

  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match) {
    const h1 = stripHtml(h1Match[1]);
    if (h1 && h1.toLowerCase() !== 'shop all') return h1;
  }
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    const cleanedTitle = normalizeSpace(
      titleMatch[1]
        .replace(/^Shop\s*-\s*/i, '')
        .replace(/AutofactorNG/gi, '')
    );
    if (cleanedTitle && cleanedTitle.toLowerCase() !== 'shop all') return cleanedTitle;
  }
  return null;
}

function extractPriceKobo(html) {
  const candidates = [];

  const ogPrice = extractMeta(html, 'product:price:amount');
  if (ogPrice) candidates.push(ogPrice);

  const nairaMatch = html.match(/₦\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i);
  if (nairaMatch) candidates.push(nairaMatch[1]);

  const text = html.slice(0, 50000);
  const generic = text.match(/([0-9][0-9,]{2,})\s*<\/?[^>]*>\s*(?:<\/?[^>]*>\s*){0,2}(?:NGN|naira|₦)/i);
  if (generic) candidates.push(generic[1]);

  for (const raw of candidates) {
    const n = Number.parseFloat(String(raw).replace(/,/g, ''));
    if (Number.isFinite(n) && n > 0) {
      return Math.round(n * 100);
    }
  }
  return null;
}

function extractDescription(html) {
  const descMeta = extractMeta(html, 'description') || extractMeta(html, 'og:description');
  if (descMeta) return descMeta;
  const sectionMatch = html.match(/PRODUCT DESCRIPTION<\/h[1-6]>\s*([\s\S]{0,4000})/i);
  if (sectionMatch) return stripHtml(sectionMatch[1]).slice(0, 900);
  return null;
}

function categorySlugFromProductUrl(productUrl) {
  const match = productUrl.match(/\/product\/([^/]+)\//i);
  return match ? match[1] : null;
}

function buildCategoryNameFromSlug(slug) {
  return String(slug || '')
    .split('-')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function inferBrand(title) {
  const normalized = normalizeSpace(title);
  const firstToken = normalized.split(' ')[0] || 'Autofactor';
  return firstToken.replace(/[^A-Za-z0-9/&.-]/g, '') || 'Autofactor';
}

function inferParentSlug(slug, knownSlugs) {
  const value = String(slug || '').trim();
  if (!value || !value.includes('-')) return null;

  const parts = value.split('-');
  for (let i = parts.length - 1; i >= 1; i -= 1) {
    const candidate = parts.slice(0, i).join('-');
    if (knownSlugs.has(candidate)) return candidate;
  }

  return null;
}

async function crawlAutofactorProducts(limit, maxPages, perCategoryLimit) {
  const homeHtml = await fetchHtml(BASE_URL);
  const categoryLinks = extractCategoryLinks(homeHtml);
  const products = [];
  const seenSlugs = new Set();

  for (const categoryUrl of categoryLinks) {
    const categoryPath = new URL(categoryUrl).pathname;
    const categorySlug = categoryPath.split('/').filter(Boolean)[1];
    if (!categorySlug) continue;

    let firstPayload;
    try {
      firstPayload = await fetchJson(categoryUrl);
    } catch {
      continue;
    }

    const lastPage = Math.min(Number(firstPayload?.meta?.last_page || 1), maxPages);
    let categoryCount = 0;

    for (let page = 1; page <= lastPage; page += 1) {
      if (categoryCount >= perCategoryLimit) break;

      let payload = firstPayload;
      if (page > 1) {
        try {
          payload = await fetchJson(`${categoryUrl}?page=${page}`);
        } catch {
          break;
        }
      }

      const rows = Array.isArray(payload?.data) ? payload.data : [];
      if (rows.length === 0) break;

      for (const row of rows) {
        if (categoryCount >= perCategoryLimit) break;

        const name = normalizeSpace(row?.name || row?.title || '');
        const rawSlug = normalizeSpace(row?.slug || '');
        const slug = rawSlug ? slugify(rawSlug) : slugify(name);
        if (!name || !slug || seenSlugs.has(slug)) continue;
        seenSlugs.add(slug);

        const image = row?.image_l || row?.image_to_show || row?.image_m || null;
        const description = stripHtml(row?.description || row?.meta_description || name);
        const brand = normalizeSpace(row?.brand?.name || row?.make || row?.generic_name || inferBrand(name));
        const priceNaira = Number(row?.price);

        products.push({
          source_url: `${BASE_URL}/product/${categorySlug}/${rawSlug || slug}`,
          title: name,
          slug,
          sku: `AF-${slug.toUpperCase().slice(0, 24)}-${products.length + 1}`,
          price_kobo: Number.isFinite(priceNaira) ? Math.round(priceNaira * 100) : null,
          image: absUrl(image),
          description: description || name,
          brand,
          category_slug: categorySlug,
        });

        categoryCount += 1;

        if (products.length >= limit) {
          console.log(`[import-autofactor] Hit overall limit ${limit}, stopping crawl`);
          return products;
        }
      }
    }

    console.log(`[import-autofactor] Category ${categorySlug}: ${categoryCount} products collected`);
  }

  return products;
}

async function upsertCategories(supabase, categorySlugs) {
  const unique = [...new Set(categorySlugs.filter(Boolean))];
  if (unique.length === 0) return new Map();

  const existing = await supabase
    .from('ladipo_categories')
    .select('id, slug, name, parent_id');
  if (existing.error) throw new Error(`Failed reading categories: ${existing.error.message}`);
  const bySlug = new Map((existing.data || []).map((c) => [c.slug, c]));

  const inserts = [];
  for (const slug of unique) {
    if (!bySlug.has(slug)) {
      inserts.push({
        name: buildCategoryNameFromSlug(slug),
        slug,
        parent_id: null,
        sort_order: 99,
      });
    }
  }

  if (inserts.length > 0) {
    const inserted = await supabase
      .from('ladipo_categories')
      .insert(inserts)
      .select('id, slug, name, parent_id');
    if (inserted.error) throw new Error(`Failed creating categories: ${inserted.error.message}`);
    for (const c of inserted.data || []) bySlug.set(c.slug, c);
  }

  // Ensure nested slugs (e.g. spare-parts-air-intake) are attached to the
  // closest existing slug prefix (e.g. spare-parts) as parent categories.
  const knownSlugs = new Set(bySlug.keys());
  const updates = [];
  for (const category of bySlug.values()) {
    const parentSlug = inferParentSlug(category.slug, knownSlugs);
    if (!parentSlug) continue;

    const parent = bySlug.get(parentSlug);
    if (!parent || parent.id === category.id) continue;
    if (category.parent_id === parent.id) continue;

    updates.push({ id: category.id, parent_id: parent.id });
  }

  for (const update of updates) {
    const { error: updateError } = await supabase
      .from('ladipo_categories')
      .update({ parent_id: update.parent_id })
      .eq('id', update.id);
    if (updateError) throw new Error(`Failed updating category hierarchy: ${updateError.message}`);
  }

  if (updates.length > 0) {
    const refreshed = await supabase
      .from('ladipo_categories')
      .select('id, slug, name, parent_id');
    if (refreshed.error) throw new Error(`Failed refreshing categories: ${refreshed.error.message}`);
    return new Map((refreshed.data || []).map((c) => [c.slug, c]));
  }

  return bySlug;
}

async function syncToDatabase(products, options) {
  const supabase = getSupabaseAdmin();

  if (options.sync) {
    await supabase.from('ladipo_part_inventory').delete().not('id', 'is', null);
    await supabase.from('ladipo_part_compatibility').delete().not('id', 'is', null);
    await supabase.from('ladipo_parts').delete().not('id', 'is', null);
  }

  const categoryMap = await upsertCategories(supabase, products.map((p) => p.category_slug));
  let created = 0;
  let skipped = 0;

  for (const product of products) {
    const category = categoryMap.get(product.category_slug);
    if (!category) {
      skipped += 1;
      continue;
    }

    const partPayload = {
      sku: product.sku,
      slug: product.slug,
      name: product.title,
      description: product.description,
      category_id: category.id,
      brand: product.brand,
      condition: 'new',
      part_type: 'aftermarket',
      images: product.image ? [product.image] : [],
      specifications: {
        source: 'autofactorng.com',
        source_url: product.source_url,
      },
      key_features: [],
      is_active: true,
      is_universal: product.category_slug.includes('lubricants')
        || product.category_slug.includes('accessories')
        || product.category_slug.includes('car-care')
        || product.category_slug.includes('battery'),
    };

    const { data: part, error: partError } = await supabase
      .from('ladipo_parts')
      .upsert(partPayload, { onConflict: 'slug', ignoreDuplicates: false })
      .select('id')
      .single();

    if (partError || !part) {
      skipped += 1;
      continue;
    }

    const fallbackPrice = 500000; // ₦5,000 default when parsing fails
    const inventoryPayload = {
      part_id: part.id,
      price_kobo: Number.isFinite(product.price_kobo) && product.price_kobo > 0 ? product.price_kobo : fallbackPrice,
      stock_qty: 50,
      seller_label: options.sellerLabel,
    };

    const { data: existingInventory, error: existingInventoryError } = await supabase
      .from('ladipo_part_inventory')
      .select('id')
      .eq('part_id', part.id)
      .maybeSingle();

    if (existingInventoryError) {
      skipped += 1;
      continue;
    }

    if (existingInventory?.id) {
      const { error: updateInventoryError } = await supabase
        .from('ladipo_part_inventory')
        .update({
          price_kobo: inventoryPayload.price_kobo,
          stock_qty: inventoryPayload.stock_qty,
          seller_label: inventoryPayload.seller_label,
        })
        .eq('id', existingInventory.id);
      if (updateInventoryError) {
        skipped += 1;
        continue;
      }
    } else {
      const { error: insertInventoryError } = await supabase
        .from('ladipo_part_inventory')
        .insert(inventoryPayload);
      if (insertInventoryError) {
        skipped += 1;
        continue;
      }
    }

    created += 1;
  }

  return { created, skipped };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  console.log(`[import-autofactor] Starting crawl (limit=${options.limit}, maxPages=${options.maxPages}, dryRun=${options.dryRun}, sync=${options.sync})`);

  console.log(`[import-autofactor] Per-category cap: ${options.perCategoryLimit}`);
  const products = await crawlAutofactorProducts(options.limit, options.maxPages, options.perCategoryLimit);
  if (products.length === 0) {
    throw new Error('No products discovered from Autofactor crawl');
  }

  console.log(`[import-autofactor] Crawled ${products.length} product pages`);

  if (options.dryRun) {
    const preview = products.slice(0, 10).map((p) => ({
      title: p.title,
      category_slug: p.category_slug,
      price_kobo: p.price_kobo,
      image: p.image,
    }));
    console.log('[import-autofactor] Dry run preview:');
    console.log(JSON.stringify(preview, null, 2));
    return;
  }

  const result = await syncToDatabase(products, options);
  console.log(`[import-autofactor] Import complete. upserted=${result.created}, skipped=${result.skipped}`);
}

main().catch((error) => {
  console.error(`[import-autofactor] Fatal error: ${error.message}`);
  process.exit(1);
});
