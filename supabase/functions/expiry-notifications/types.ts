/**
 * TYPESCRIPT TYPE DEFINITIONS
 * 
 * Interfaces for the expiry notification system
 */

export interface Car {
  id: number;
  slug: string;
  user_id: string;           // UUID from auth.users
  name_of_owner: string;
  vehicle_make: string;
  vehicle_model: string;
  vehicle_year: number;
  registration_no: string;
  expiry_date: string;       // ISO date string (YYYY-MM-DD)
  created_at: string;
  phone_number?: string;
  address?: string;
  vehicle_color?: string;
  car_type?: 'private' | 'commercial';
}

export interface UserProfile {
  id: string;                // UUID from auth.users
  user_id: string;           // 6-char custom ID from profiles
  first_name: string;
  last_name: string;
  email: string;
}

export type NotificationType =
  | 'reminder_30d'
  | 'reminder_14d'
  | 'reminder_7d'
  | 'reminder_3d'
  | 'reminder_2d'
  | 'reminder_1d'
  | 'expiry_day'
  | 'overdue_3d'
  | 'overdue_7d';

export interface NotificationInterval {
  days: number;
  type: NotificationType;
  name: string;
}

export interface NotificationTask {
  car: Car;
  profile: UserProfile;
  notificationType: NotificationType;
  expiryDate: Date;
  daysUntilExpiry: number;
}

export interface EmailResult {
  success: boolean;
  emailId?: string;
  error?: string;
  retryCount: number;
}

export interface ProcessingResult {
  totalCars: number;
  emailsSent: number;
  emailsFailed: number;
  alreadySent: number;
  errors: Array<{
    carId: number;
    error: string;
  }>;
  executionTimeMs: number;
}

export interface TargetDateMap {
  [notificationType: string]: Date;
}

export interface NotificationHistory {
  id: number;
  car_id: number;
  user_id: string;
  notification_type: NotificationType;
  expiry_date: string;
  email_sent_to: string;
  email_sent_at: string;
  resend_email_id?: string;
  created_at: string;
}

export interface ErrorLog {
  id: number;
  car_id?: number;
  user_id?: string;
  notification_type?: NotificationType;
  error_code: string;
  error_message: string;
  error_stack?: string;
  function_name?: string;
  execution_id?: string;
  retry_count?: number;
  created_at: string;
  resolved_at?: string;
}
