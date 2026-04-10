import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export class ReminderRepository {
  private supabase;

  constructor(supabaseUrl: string, supabaseServiceKey: string) {
    this.supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }

  async getDueExpiryReminders(daysUntilExpiry: number) {
    const target = new Date();
    target.setUTCDate(target.getUTCDate() + daysUntilExpiry);
    const date = target.toISOString().slice(0, 10);
    const flagColumn = `notified_${daysUntilExpiry}_days`;

    const { data, error } = await this.supabase
      .from('deferred_document_reminders')
      .select('id, user_id, guest_email, document_name, expiry_date, car_id')
      .eq('expiry_date', date)
      .eq(flagColumn, false)
      .in('reason', ['not_expired', 'custom']);

    if (error) throw error;
    return data || [];
  }

  async markExpiryReminderSent(id: number, daysUntilExpiry: number) {
    const flagColumn = `notified_${daysUntilExpiry}_days`;
    const { error } = await this.supabase
      .from('deferred_document_reminders')
      .update({ [flagColumn]: true })
      .eq('id', id);
    if (error) throw error;
  }

  async getDueSkippedNudges(hours: number) {
    const flagColumn = `nudge_${hours}h_sent`;
    const threshold = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    const { data, error } = await this.supabase
      .from('deferred_document_reminders')
      .select('id, user_id, guest_email, document_name, car_id, created_at')
      .eq('reason', 'skipped')
      .eq(flagColumn, false)
      .lte('created_at', threshold);

    if (error) throw error;
    return data || [];
  }

  async markSkippedNudgeSent(ids: number[], hours: number) {
    if (!ids.length) return;
    const flagColumn = `nudge_${hours}h_sent`;
    const { error } = await this.supabase
      .from('deferred_document_reminders')
      .update({ [flagColumn]: true })
      .in('id', ids);
    if (error) throw error;
  }

  async getProfilesByIds(userIds: string[]) {
    if (!userIds.length) return [];
    const { data, error } = await this.supabase
      .from('profiles')
      .select('id, first_name, email')
      .in('id', userIds)
      .is('deleted_at', null);
    if (error) throw error;
    return data || [];
  }

  async getCarsByIds(carIds: number[]) {
    if (!carIds.length) return [];
    const { data, error } = await this.supabase
      .from('cars')
      .select('id, registration_no, vehicle_make, vehicle_model')
      .in('id', carIds);
    if (error) throw error;
    return data || [];
  }
}
