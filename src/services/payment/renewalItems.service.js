/**
 * RENEWAL ITEMS SERVICE
 *
 * Fetches and validates renewal items from the database.
 */

import { getSupabaseAdmin } from '../../config/supabase.js';
import { logError } from '../../utils/logger.js';

export class RenewalItemsError extends Error {
  constructor(message, statusCode = 500, code = null) {
    super(message);
    this.name = 'RenewalItemsError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export async function getRenewalItems({ includeInactive = false } = {}) {
  const supabaseAdmin = getSupabaseAdmin();

  let query = supabaseAdmin
    .from('renewal_items')
    .select('item_key, name, price, required, active')
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

  return (items || []).map((item) => ({
    id: item.item_key,
    name: item.name,
    price: item.price,
    required: item.required
  }));
}

export async function validateRenewalItemsSelection(selectedItemIds = []) {
  if (!Array.isArray(selectedItemIds) || selectedItemIds.length === 0) {
    return { valid: false, error: 'At least one renewal item must be selected' };
  }

  const items = await getRenewalItems();
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
