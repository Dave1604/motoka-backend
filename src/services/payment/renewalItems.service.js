/**
 * RENEWAL ITEMS SERVICE
 *
 * Fetches and validates renewal items from the database.
 */

import { getSupabaseAdmin } from '../../config/supabase.js';
import { logError } from '../../utils/logger.js';

// Short-lived cache so duplicate calls within a single request lifecycle are free.
// Renewal items rarely change; 60 s is safe and eliminates the N+1 re-fetch in the
// Monicredit adapter without coupling the adapter to the controller's data.
// Keyed by state: Lagos carries its own road worthiness price (migration 117), so a
// single shared entry would quote one state's price to a customer in another.
const _itemsCache = new Map();
const ITEMS_CACHE_TTL = 60_000;

export class RenewalItemsError extends Error {
  constructor(message, statusCode = 500, code = null) {
    super(message);
    this.name = 'RenewalItemsError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export async function getRenewalItems({ includeInactive = false, state = null } = {}) {
  // Only cache the default (active-only) query — admin calls with includeInactive bypass cache
  const canUseCache = !includeInactive;
  const cacheKey = state || '';
  if (canUseCache) {
    const cached = _itemsCache.get(cacheKey);
    if (cached && (Date.now() - cached.at) < ITEMS_CACHE_TTL) {
      return cached.items;
    }
  }

  const supabaseAdmin = getSupabaseAdmin();

  let query = supabaseAdmin
    .from('renewal_items')
    .select('item_key, name, price, price_lagos, required, active')
    .order('required', { ascending: false })
    .order('name', { ascending: true });

  if (!includeInactive) {
    query = query.eq('active', true);
  }

  const { data: items, error } = await query;

  if (error) {
    logError('Get renewal items error', { error });
    throw new RenewalItemsError('Failed to retrieve renewal items', 500, 'DB_ERROR');
  }

  const result = (items || []).map((item) => ({
    id: item.item_key,
    name: item.name,
    price: state === 'Lagos' && item.price_lagos != null ? Number(item.price_lagos) : Number(item.price),
    required: item.required
  }));

  if (canUseCache) {
    _itemsCache.set(cacheKey, { items: result, at: Date.now() });
  }

  return result;
}

export async function validateRenewalItemsSelection(selectedItemIds = [], state = null) {
  if (!Array.isArray(selectedItemIds) || selectedItemIds.length === 0) {
    return { valid: false, error: 'At least one renewal item must be selected' };
  }

  const items = await getRenewalItems({ state });
  const itemMap = new Map(items.map((item) => [item.id, item]));

  for (const itemId of selectedItemIds) {
    if (!itemMap.has(itemId)) {
      return { valid: false, error: `Invalid renewal item: ${itemId}` };
    }
  }

  const requiredItems = items.filter((item) => item.required).map((item) => item.id);
  for (const requiredId of requiredItems) {
    if (!selectedItemIds.includes(requiredId)) {
      const requiredItem = itemMap.get(requiredId);
      return { valid: false, error: `${requiredItem.name} is required and cannot be deselected` };
    }
  }

  let total = 0;
  for (const itemId of selectedItemIds) {
    const item = itemMap.get(itemId);
    total += item.price;
  }

  return { valid: true, total };
}
