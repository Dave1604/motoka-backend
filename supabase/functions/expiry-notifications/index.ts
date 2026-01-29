import { createClient } from 'npm:@supabase/supabase-js@2';
import { Resend } from 'npm:resend@6';

const NOTIFICATION_INTERVALS = [
  { days: 30, type: '30_days' },
  { days: 14, type: '14_days' },
  { days: 7, type: '7_days' },
  { days: 3, type: '3_days' },
  { days: 2, type: '2_days' },
  { days: 1, type: '1_day' }
];

const RETRY_CONFIG = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2
};

const RATE_LIMIT_CONFIG = {
  delayBetweenEmailsMs: 100,      // 100ms between each email
  batchSize: 10,                   // Process 10 emails per batch
  delayBetweenBatchesMs: 1000      // 1 second between batches
};

/**
 * Retry utility with exponential backoff
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  fnName: string = 'operation',
  maxRetries: number = RETRY_CONFIG.maxRetries
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (attempt === maxRetries) {
        break;
      }
      
      const delay = Math.min(
        RETRY_CONFIG.initialDelayMs * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt),
        RETRY_CONFIG.maxDelayMs
      );
      
      console.warn(
        `[Retry] ${fnName} attempt ${attempt + 1} failed, retrying in ${delay}ms. Error: ${error.message}`
      );
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError || new Error(`${fnName} failed after ${maxRetries} retries`);
}

/**
 * Delay utility for rate limiting
 */
async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
}

/**
 * Send expiry reminder email via Resend (with retry)
 */
async function sendExpiryReminder(
  resend: InstanceType<typeof Resend>,
  emailFrom: string,
  to: string,
  userName: string,
  vehicleName: string,
  registrationNo: string,
  daysRemaining: number,
  expiryDate: string
) {
  return retryWithBackoff(
    async () => {
      const urgencyLevel = daysRemaining <= 3 ? 'high' : daysRemaining <= 7 ? 'medium' : 'low';
      const urgencyColor = urgencyLevel === 'high' ? '#dc3545' : urgencyLevel === 'medium' ? '#1B6DBD' : '#1B6DBD';
      const brandPrimary = '#1B6DBD';
  
  const subject = daysRemaining === 1 
    ? `🚨 URGENT: Vehicle Registration Expires Tomorrow`
    : daysRemaining === 0
    ? `🚨 FINAL NOTICE: Vehicle Registration Expires TODAY`
    : `⚠️ Reminder: Vehicle Registration Expires in ${daysRemaining} Days`;
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f4f4; }
        .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e6e9ef; }
        .header { background-color: ${brandPrimary}; color: #ffffff; padding: 30px 20px; text-align: center; }
        .content { padding: 40px 30px; }
        .alert-box { background-color: #f5f9ff; border-left: 4px solid ${urgencyColor}; padding: 20px; margin: 30px 0; border-radius: 6px; }
        .alert-title { color: ${urgencyColor}; font-size: 20px; font-weight: bold; margin-bottom: 10px; }
        .vehicle-info { background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .info-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e9ecef; }
        .info-label { font-weight: 600; color: #6c757d; }
        .info-value { color: #1a1a1a; }
        .cta-button { display: inline-block; background-color: ${brandPrimary}; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; margin-top: 20px; }
        .footer { background-color: #f8f9fa; padding: 20px; text-align: center; font-size: 12px; color: #6c757d; }
        .countdown { font-size: 48px; font-weight: bold; color: ${urgencyColor}; text-align: center; margin: 20px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🚗 Vehicle Registration Reminder</h1>
        </div>
        <div class="content">
          <p>Hello ${userName},</p>
          
          <div class="alert-box">
            <div class="alert-title">
              ${daysRemaining === 0 ? '⚠️ Expires Today!' : daysRemaining === 1 ? '⚠️ Expires Tomorrow!' : `⚠️ ${daysRemaining} Days Remaining`}
            </div>
            <p style="margin: 0;">Your vehicle registration is about to expire. Please renew it promptly to avoid penalties and stay compliant.</p>
          </div>

          <div class="countdown">${daysRemaining}</div>
          <p style="text-align: center; color: #6c757d; margin-top: -10px;">day${daysRemaining === 1 ? '' : 's'} remaining</p>

          <div class="vehicle-info">
            <h3 style="margin-top: 0;">Vehicle Details</h3>
            <div class="info-row">
              <span class="info-label">Vehicle:</span>
              <span class="info-value">${vehicleName}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Registration No:</span>
              <span class="info-value">${registrationNo}</span>
            </div>
            <div class="info-row" style="border-bottom: none;">
              <span class="info-label">Expiry Date:</span>
              <span class="info-value" style="color: ${urgencyColor}; font-weight: bold;">${expiryDate}</span>
            </div>
          </div>

          <div style="background-color: #f5f9ff; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0;"><strong>💡 Next steps:</strong></p>
            <ul style="margin: 10px 0;">
              <li>Visit Motoka to renew your documents: motokapp.ng</li>
              <li>Have your vehicle details ready</li>
              <li>Complete the renewal before the expiry date</li>
            </ul>
          </div>

          <p style="color: #6c757d; font-size: 14px; margin-top: 30px;">
            <strong>Important:</strong> Driving with an expired registration is illegal and may result in fines, vehicle impoundment, or other penalties.
          </p>

          <div style="text-align: center;">
            <a href="https://motokapp.ng" class="cta-button">Renew on Motoka</a>
          </div>
        </div>
        <div class="footer">
          <p>© ${new Date().getFullYear()} Motoka. All rights reserved.</p>
          <p>This is an automated reminder. Please do not reply to this email.</p>
          <p style="margin-top: 10px;">Motoka - Your Vehicle Management Partner</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const { data, error } = await resend.emails.send({
        from: emailFrom,
        to,
        subject,
        html
      });

      if (error) {
        throw new Error(`Email send failed: ${error.message}`);
      }

      return data?.id;
    },
    `sendEmail(${to})`,
    RETRY_CONFIG.maxRetries
  );
}

/**
 * Check if notification has already been sent (with retry)
 */
async function isNotificationSent(
  supabase: ReturnType<typeof createClient>,
  carId: number,
  notificationType: string,
  expiryDate: string
): Promise<boolean> {
  return retryWithBackoff(
    async () => {
      const { data } = await supabase
        .from('expiry_notifications')
        .select('id')
        .eq('car_id', carId)
        .eq('notification_type', notificationType)
        .eq('expiry_date', expiryDate)
        .single();

      return !!data;
    },
    `isNotificationSent(car_id=${carId}, type=${notificationType})`,
    RETRY_CONFIG.maxRetries
  );
}

/**
 * Record that a notification was sent (with retry)
 */
async function recordNotification(
  supabase: ReturnType<typeof createClient>,
  carId: number,
  userId: string,
  notificationType: string,
  expiryDate: string,
  emailId: string
) {
  return retryWithBackoff(
    async () => {
      const { error } = await supabase
        .from('expiry_notifications')
        .insert({
          car_id: carId,
          user_id: userId,
          notification_type: notificationType,
          expiry_date: expiryDate,
          email_id: emailId
        });

      if (error) throw error;
    },
    `recordNotification(car_id=${carId}, type=${notificationType})`,
    RETRY_CONFIG.maxRetries
  );
}

/**
 * Get target date N days from now
 */
function getTargetDate(daysFromNow: number): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + daysFromNow);
  return date.toISOString().split('T')[0];
}

/**
 * Main handler
 */
Deno.serve(async (req: Request) => {
  try {
    // Only accept POST requests
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Validate API key from Authorization header
    const authHeader = req.headers.get('Authorization');
    const expectedSecret = Deno.env.get('CRON_SECRET_KEY');
    
    if (!expectedSecret) {
      throw new Error('CRON_SECRET_KEY environment variable not set');
    }

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Missing or invalid Authorization header' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const providedSecret = authHeader.substring(7);
    if (providedSecret !== expectedSecret) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Invalid API key' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get secrets
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    const emailFrom = Deno.env.get('EMAIL_FROM') || 'Motoka <no-reply@motokaapp.ng>';
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!resendApiKey || !supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing required environment variables');
    }

    // Initialize clients
    const resend = new Resend(resendApiKey);
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    console.log('[Cron] Starting expiry notification check');

    const summary = {
      timestamp: new Date().toISOString(),
      intervals: [],
      totals: {
        total: 0,
        sent: 0,
        skipped: 0,
        failed: 0
      }
    };

    // Process each notification interval
    for (const interval of NOTIFICATION_INTERVALS) {
      const targetDate = getTargetDate(interval.days);
      console.log(`[Cron] Checking for vehicles expiring on ${targetDate}`);

      // Get vehicles
      const { data: cars, error: queryError } = await supabase
        .from('cars')
        .select(`
          id,
          user_id,
          vehicle_make,
          vehicle_model,
          registration_no,
          expiry_date
        `)
        .eq('status', 'approved')
        .eq('expiry_date', targetDate)
        .is('deleted_at', null)
        .not('registration_no', 'is', null);

      if (queryError) throw queryError;

      const userIds = (cars || []).map((car) => car.user_id).filter(Boolean);
      const profilesById = new Map<string, { id: string; email: string; first_name: string; last_name: string }>();

      if (userIds.length > 0) {
        const { data: profiles, error: profilesError } = await supabase
          .from('profiles')
          .select('id,email,first_name,last_name')
          .in('id', userIds);

        if (profilesError) throw profilesError;

        for (const profile of profiles || []) {
          profilesById.set(profile.id, profile);
        }
      }

      const intervalResult = {
        interval: interval.days,
        type: interval.type,
        total: cars?.length || 0,
        sent: 0,
        skipped: 0,
        failed: 0
      };

      // Process vehicles in batches with rate limiting
      const batchSize = RATE_LIMIT_CONFIG.batchSize;
      const carsArray = cars || [];
      
      for (let batchIndex = 0; batchIndex < carsArray.length; batchIndex += batchSize) {
        const batch = carsArray.slice(batchIndex, batchIndex + batchSize);
        console.log(`[Cron] Processing batch ${Math.ceil(batchIndex / batchSize) + 1} of ${Math.ceil(carsArray.length / batchSize)} for ${interval.type}`);
        
        // Process each car in the batch
        for (let carIndex = 0; carIndex < batch.length; carIndex++) {
          const car = batch[carIndex];
          
          try {
            const alreadySent = await isNotificationSent(
              supabase,
              car.id,
              interval.type,
              car.expiry_date
            );

            if (alreadySent) {
              console.log(`[Cron] Skipped ${car.registration_no} (${interval.type}) - already sent`);
              intervalResult.skipped++;
              // Still add delay to maintain rate limit consistency
              if (carIndex < batch.length - 1) {
                await delay(RATE_LIMIT_CONFIG.delayBetweenEmailsMs);
              }
              continue;
            }

            const userProfile = profilesById.get(car.user_id);

            if (!userProfile) {
              console.warn(`[Cron] Skipped ${car.registration_no} - profile not found`);
              intervalResult.skipped++;
              if (carIndex < batch.length - 1) {
                await delay(RATE_LIMIT_CONFIG.delayBetweenEmailsMs);
              }
              continue;
            }
            
            const userName = `${userProfile.first_name} ${userProfile.last_name}`;
            const vehicleName = `${car.vehicle_make} ${car.vehicle_model}`;
            const formattedDate = formatDate(car.expiry_date);

            // Send email
            const emailId = await sendExpiryReminder(
              resend,
              emailFrom,
              userProfile.email,
              userName,
              vehicleName,
              car.registration_no,
              interval.days,
              formattedDate
            );

            // Record notification
            await recordNotification(
              supabase,
              car.id,
              car.user_id,
              interval.type,
              car.expiry_date,
              emailId
            );

            console.log(`[Cron] Sent ${car.registration_no} (${interval.type})`);
            intervalResult.sent++;
            
            // Add delay between emails to prevent API overload
            if (carIndex < batch.length - 1) {
              await delay(RATE_LIMIT_CONFIG.delayBetweenEmailsMs);
            }
          } catch (error) {
            console.error(`[Cron] Error for ${car.registration_no}:`, error.message);
            intervalResult.failed++;
            // Still maintain delay on errors
            if (carIndex < batch.length - 1) {
              await delay(RATE_LIMIT_CONFIG.delayBetweenEmailsMs);
            }
          }
        }
        
        // Add delay between batches (except after the last batch)
        if (batchIndex + batchSize < carsArray.length) {
          console.log(`[Cron] Batch complete, waiting ${RATE_LIMIT_CONFIG.delayBetweenBatchesMs}ms before next batch...`);
          await delay(RATE_LIMIT_CONFIG.delayBetweenBatchesMs);
        }
      }

      summary.intervals.push(intervalResult);
      summary.totals.total += intervalResult.total;
      summary.totals.sent += intervalResult.sent;
      summary.totals.skipped += intervalResult.skipped;
      summary.totals.failed += intervalResult.failed;
    }

    console.log('[Cron] Completed', summary);

    return new Response(JSON.stringify({
      success: true,
      message: 'Expiry notification check completed',
      data: summary
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('[Cron] Error:', error.message);
    return new Response(JSON.stringify({
      success: false,
      message: 'Notification check failed',
      error: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});
