import { getSupabaseAdmin } from '../config/supabase.js';
import * as response from '../utils/responses.js';

export const getProfile = async (req, res) => {
  try {
    const profile = req.user.profile;
    
    return response.success(res, {
      profile: {
        id: req.user.id,
        user_id: profile.user_id,
        email: req.user.email,
        first_name: profile.first_name,
        last_name: profile.last_name,
        phone_number: profile.phone_number,
        image: profile.image,
        nin: profile.nin,
        address: profile.address,
        gender: profile.gender,
        user_type: profile.user_type,
        two_factor_enabled: profile.two_factor_enabled,
        two_factor_type: profile.two_factor_type,
        created_at: profile.created_at,
        updated_at: profile.updated_at
      }
    });
  } catch (error) {
    console.error('Get profile error:', error);
    return response.serverError(res, 'Failed to retrieve profile');
  }
};

export const updateProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { first_name, last_name, phone_number, image, nin, address, gender } = req.body;
    const supabaseAdmin = getSupabaseAdmin();
    
    const updates = {};
    if (first_name !== undefined) updates.first_name = first_name;
    if (last_name !== undefined) updates.last_name = last_name;
    if (phone_number !== undefined) updates.phone_number = phone_number;
    if (image !== undefined) updates.image = image;
    if (nin !== undefined) updates.nin = nin;
    if (address !== undefined) updates.address = address;
    if (gender !== undefined) updates.gender = gender;
    
    if (Object.keys(updates).length === 0) {
      return response.error(res, 'No fields to update');
    }
    
    if (phone_number) {
      const { data: existing } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('phone_number', phone_number)
        .neq('id', userId)
        .single();
      
      if (existing) {
        return response.error(res, 'Phone number already in use', 409);
      }
    }
    
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .update(updates)
      .eq('id', userId)
      .select()
      .single();
    
    if (error) {
      console.error('Profile update error:', error);
      return response.error(res, 'Failed to update profile');
    }
    
    return response.success(res, {
      profile: {
        id: userId,
        user_id: profile.user_id,
        email: req.user.email,
        first_name: profile.first_name,
        last_name: profile.last_name,
        phone_number: profile.phone_number,
        image: profile.image,
        nin: profile.nin,
        address: profile.address,
        gender: profile.gender,
        user_type: profile.user_type,
        two_factor_enabled: profile.two_factor_enabled,
        two_factor_type: profile.two_factor_type,
        created_at: profile.created_at,
        updated_at: profile.updated_at
      }
    }, 'Profile updated successfully');
  } catch (error) {
    console.error('Update profile error:', error);
    return response.serverError(res, 'Failed to update profile');
  }
};
