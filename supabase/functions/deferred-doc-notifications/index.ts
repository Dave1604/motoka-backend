import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { CONFIG } from './config.ts';
import { ReminderRepository } from './reminderRepository.ts';
import { ReminderEmailService } from './emailService.ts';

type ReminderRow = {
  id: number;
  user_id: string | null;
  guest_email: string | null;
  document_name: string;
  expiry_date?: string | null;
  car_id?: number | null;
};

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    const emailFrom = Deno.env.get('EMAIL_FROM');
    const frontendUrl = Deno.env.get('FRONTEND_URL') || CONFIG.defaultFrontendUrl;

    if (!supabaseUrl || !supabaseKey || !resendApiKey || !emailFrom) {
      return new Response(JSON.stringify({ error: 'Missing environment configuration' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const repository = new ReminderRepository(supabaseUrl, supabaseKey);
    const email = new ReminderEmailService(resendApiKey, emailFrom, frontendUrl);

    let expiryEmailsSent = 0;
    let nudgeEmailsSent = 0;

    const enrichRows = async (rows: ReminderRow[]) => {
      const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))] as string[];
      const carIds = [...new Set(rows.map((r) => r.car_id).filter(Boolean))] as number[];
      const profiles = await repository.getProfilesByIds(userIds);
      const cars = await repository.getCarsByIds(carIds);
      const profileMap = new Map(profiles.map((p: any) => [p.id, p]));
      const carMap = new Map(cars.map((c: any) => [c.id, c]));

      return rows.map((row) => {
        const profile = row.user_id ? profileMap.get(row.user_id) : null;
        const car = row.car_id ? carMap.get(row.car_id) : null;
        const carInfo = car
          ? `${car.vehicle_make || ''} ${car.vehicle_model || ''} (${car.registration_no || 'N/A'})`.trim()
          : 'Your vehicle';
        return {
          ...row,
          to: row.guest_email || profile?.email || null,
          firstName: profile?.first_name || null,
          carInfo
        };
      });
    };

    for (const days of CONFIG.expiryWindows) {
      const due = await repository.getDueExpiryReminders(days);
      const reminders = await enrichRows(due as ReminderRow[]);
      for (const row of reminders) {
        if (!row.to || !row.expiry_date) continue;
        await email.sendDeferredExpiryEmail({
          to: row.to,
          firstName: row.firstName,
          documentName: row.document_name,
          expiryDate: row.expiry_date,
          daysUntilExpiry: days,
          carInfo: row.carInfo
        });
        await repository.markExpiryReminderSent(row.id, days);
        expiryEmailsSent += 1;
      }
    }

    for (const hours of CONFIG.nudgeHours) {
      const due = await repository.getDueSkippedNudges(hours);
      const reminders = await enrichRows(due as ReminderRow[]);
      const grouped = new Map<string, { ids: number[]; to: string; firstName?: string | null; carInfo?: string | null; docs: string[] }>();

      for (const row of reminders) {
        if (!row.to) continue;
        const key = `${row.to}|${row.car_id || 0}`;
        if (!grouped.has(key)) {
          grouped.set(key, {
            ids: [],
            to: row.to,
            firstName: row.firstName,
            carInfo: row.carInfo,
            docs: []
          });
        }
        const bucket = grouped.get(key)!;
        bucket.ids.push(row.id);
        if (!bucket.docs.includes(row.document_name)) bucket.docs.push(row.document_name);
      }

      const nudgeDay = hours === 24 ? 1 : hours === 48 ? 2 : 3;
      for (const group of grouped.values()) {
        await email.sendSkippedNudgeEmail({
          to: group.to,
          firstName: group.firstName,
          skippedDocNames: group.docs,
          nudgeDay,
          carInfo: group.carInfo
        });
        await repository.markSkippedNudgeSent(group.ids, hours);
        nudgeEmailsSent += 1;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        summary: {
          expiryEmailsSent,
          nudgeEmailsSent
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: (error as Error).message || 'Unexpected failure' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
