import { createClient } from '@supabase/supabase-js';

/**
 * SCALABILITY: Singleton pattern for Supabase clients
 * These clients are created once and reused across all requests
 * to avoid connection pool exhaustion at scale
 */
let _supabase = null;
let _supabaseAdmin = null;

/**
 * Returns singleton Supabase client with anon key (RLS enabled)
 * Safe for concurrent requests - created once, reused forever
 */
export function getSupabase() {
  if (!_supabase) {
    const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
    }
    _supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return _supabase;
}

/**
 * Returns singleton Supabase admin client with service role key
 * Bypasses RLS - use only in server-side code
 * Safe for concurrent requests - created once, reused forever
 */
export function getSupabaseAdmin() {
  if (!_supabaseAdmin) {
    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    }
    _supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
  }
  return _supabaseAdmin;
}

/**
 * Creates a user-scoped Supabase client that respects RLS policies
 * 
 * NOTE: This creates a NEW client per call (by design, not a bug)
 * Each user needs their own client with their auth token for RLS to work correctly
 * This is acceptable overhead as these clients are lightweight and short-lived
 * 
 * @param {string} accessToken - User's access token
 * @returns {Object} Supabase client instance with user's auth context
 */
export function getSupabaseUser(accessToken) {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
  }
  
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}