import { getSupabaseAdmin } from '../config/supabase.js';

/**
 * Fetch all active driver license prices from the database.
 * Returns an array ordered by license_type (new, renew).
 */
export const getDriverLicensePrices = async () => {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from('driver_license_prices')
    .select('id, license_type, duration, price, description')
    .eq('is_active', true)
    .order('license_type', { ascending: true })
    .order('price', { ascending: true });

  if (error) throw error;
  return data;
};
