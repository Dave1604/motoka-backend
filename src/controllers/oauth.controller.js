import { getSupabase, getSupabaseAdmin } from '../config/supabase.js';
import * as response from '../utils/responses.js';

/**
 * OAuth Controller
 * Handles Google OAuth authentication via Supabase Auth
 */

/**
 * Initiate Google OAuth flow
 * Returns the OAuth URL for the client to redirect to
 */
export const googleLogin = async (req, res) => {
  try {
    const supabase = getSupabase();
    
    // Get frontend URL from environment or default
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const redirectTo = `${frontendUrl}/auth/callback`;
    
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    });
    
    if (error) {
      console.error('Google OAuth error:', error);
      return response.error(res, error.message);
    }
    
    // Return the OAuth URL for the client to redirect to
    return response.success(res, { url: data.url }, 'Google OAuth URL generated');
  } catch (error) {
    console.error('Google OAuth error:', error);
    return response.serverError(res, 'Failed to initiate Google login');
  }
};

/**
 * Handle OAuth callback
 * Exchanges the OAuth code for a session
 */
export const handleCallback = async (req, res) => {
  try {
    const { code } = req.query;
    
    if (!code) {
      return response.error(res, 'Missing authorization code', 400);
    }
    
    const supabase = getSupabase();
    const supabaseAdmin = getSupabaseAdmin();
    
    // Exchange code for session
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    
    if (error) {
      console.error('OAuth callback error:', error);
      return response.error(res, error.message);
    }
    
    const user = data.user;
    const session = data.session;
    
    // Get or create profile
    let { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();
    
    // If profile doesn't exist (first time Google login), it should have been created by the trigger
    // But let's check suspension/deletion status
    if (profile?.is_suspended) {
      return response.forbidden(res, 'Your account has been suspended');
    }
    
    if (profile?.deleted_at) {
      return response.forbidden(res, 'Your account has been deleted');
    }
    
    return response.success(res, {
      user: { 
        id: user.id, 
        email: user.email, 
        email_verified: !!user.email_confirmed_at,
        ...profile 
      },
      session
    }, 'Google login successful');
  } catch (error) {
    console.error('OAuth callback error:', error);
    return response.serverError(res, 'OAuth callback failed');
  }
};
