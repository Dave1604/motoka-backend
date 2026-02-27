import { getSupabaseAdmin } from '../config/supabase.js';

/**
 * Fetch all active plate number prices from the database.
 * Returns an array ordered by plate_type, sub_type.
 */
export const getPlateNumberPrices = async () => {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from('plate_number_prices')
    .select('id, plate_type, sub_type, price, description')
    .eq('is_active', true)
    .order('plate_type', { ascending: true })
    .order('sub_type', { ascending: true, nullsFirst: true });

  if (error) throw error;
  return data;
};
