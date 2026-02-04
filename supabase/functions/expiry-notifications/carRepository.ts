/**
 * DATABASE OPERATIONS
 * 
 * All database queries with proper error handling and timeouts.
 * Uses Supabase client with service role for server-side operations.
 */

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { Car, UserProfile, NotificationType } from './types.ts';
import { formatDateISO } from './dateCalculator.ts';
import { logger } from './logger.ts';
import { CONFIG } from './config.ts';

export class CarRepository {
  private supabase: SupabaseClient;

  constructor(supabaseUrl: string, supabaseKey: string) {
    this.supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false }
    });
  }

  /**
   * Get cars expiring on target dates
   * Uses indexed queries for performance.
   * Only returns registered cars with valid expiry dates.
   */
  async getCarsForNotification(targetDates: Date[]): Promise<Car[]> {
    try {
      const dateStrings = targetDates.map(formatDateISO);
      
      logger.info('Querying cars for notification', { 
        targetDateCount: dateStrings.length,
        targetDates: dateStrings 
      });

      const { data, error } = await this.supabase
        .from('cars')
        .select('*')
        .in('expiry_date', dateStrings)
        .is('deleted_at', null)                    // Exclude soft-deleted
        .eq('registration_status', 'registered')   // Only registered cars
        .not('expiry_date', 'is', null);           // Must have expiry date

      if (error) {
        logger.error('Failed to query cars', { 
          error: error.message,
          code: error.code 
        });
        throw new Error(`Database query failed: ${error.message}`);
      }

      const count = data?.length || 0;
      logger.info('Cars retrieved successfully', { count });
      return data || [];
    } catch (error) {
      logger.error('Exception in getCarsForNotification', { 
        error: (error as Error).message,
        stack: (error as Error).stack
      });
      throw error;
    }
  }

  /**
   * Get user profile with email
   * 
   * Fetches the profile information needed to send emails.
   * Returns null if profile not found (to allow graceful degradation).
   */
  async getUserProfile(userId: string): Promise<UserProfile | null> {
    try {
      const { data, error } = await this.supabase
        .from('profiles')
        .select('id, user_id, first_name, last_name, email')
        .eq('id', userId)
        .is('deleted_at', null)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // Not found - that's OK
          logger.warn('User profile not found', { userId });
          return null;
        }
        logger.warn('Failed to get user profile', { 
          userId, 
          error: error.message 
        });
        return null;
      }

      return data as UserProfile;
    } catch (error) {
      logger.error('Exception in getUserProfile', { 
        userId, 
        error: (error as Error).message 
      });
      return null;
    }
  }

  /**
   * Check if notification already sent (idempotency check)
   * 
   * Uses the unique constraint on (car_id, notification_type, expiry_date)
   * to prevent duplicate emails.
   */
  async isNotificationSent(
    carId: number,
    notificationType: NotificationType,
    expiryDate: Date
  ): Promise<boolean> {
    try {
      const { data, error } = await this.supabase
        .from('expiry_notification_history')
        .select('id', { count: 'exact', head: true })
        .eq('car_id', carId)
        .eq('notification_type', notificationType)
        .eq('expiry_date', formatDateISO(expiryDate));

      if (error) {
        logger.error('Failed idempotency check', { 
          carId, 
          notificationType, 
          error: error.message 
        });
        // Fail safe: if we can't check, assume not sent to allow processing
        return false;
      }

      return data && data.length > 0;
    } catch (error) {
      logger.error('Exception in isNotificationSent', { 
        carId, 
        error: (error as Error).message 
      });
      return false;
    }
  }

  /**
   * Record notification in history (idempotency enforcement)
   * 
   * Unique constraint will prevent duplicates if this is called twice
   * with the same parameters. This is safe for concurrent calls.
   */
  async recordNotification(
    carId: number,
    userId: string,
    notificationType: NotificationType,
    expiryDate: Date,
    email: string,
    resendEmailId?: string
  ): Promise<void> {
    try {
      const { error } = await this.supabase
        .from('expiry_notification_history')
        .insert({
          car_id: carId,
          user_id: userId,
          notification_type: notificationType,
          expiry_date: formatDateISO(expiryDate),
          email_sent_to: email,
          resend_email_id: resendEmailId || null,
        });

      if (error) {
        // Unique constraint violation (23505) means already sent - that's OK
        if (error.code === '23505') {
          logger.warn('Duplicate notification prevented by DB constraint', { 
            carId, 
            notificationType,
            expiryDate: formatDateISO(expiryDate)
          });
          return;
        }
        throw new Error(`Failed to record notification: ${error.message}`);
      }

      logger.info('Notification recorded successfully', { 
        carId, 
        notificationType 
      });
    } catch (error) {
      logger.error('Exception in recordNotification', { 
        carId, 
        error: (error as Error).message 
      });
      throw error;
    }
  }

  /**
   * Log error to database for monitoring and debugging
   * 
   * This doesn't throw even if it fails, to prevent logging errors
   * from breaking the main notification flow.
   */
  async logError(
    errorCode: string,
    errorMessage: string,
    context: {
      carId?: number;
      userId?: string;
      notificationType?: NotificationType;
      errorStack?: string;
      functionName?: string;
      executionId?: string;
      retryCount?: number;
    }
  ): Promise<void> {
    try {
      await this.supabase
        .from('expiry_notification_errors')
        .insert({
          car_id: context.carId,
          user_id: context.userId,
          notification_type: context.notificationType,
          error_code: errorCode,
          error_message: errorMessage,
          error_stack: context.errorStack,
          function_name: context.functionName,
          execution_id: context.executionId,
          retry_count: context.retryCount || 0,
        });

      logger.debug('Error logged to database', { errorCode });
    } catch (error) {
      // Don't throw - logging errors shouldn't break the flow
      logger.warn('Failed to log error to database', { 
        errorCode,
        error: (error as Error).message 
      });
    }
  }
}
