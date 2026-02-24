/**
 * EMAIL SERVICE WITH RETRY LOGIC
 * 
 * Sends emails via Resend API with exponential backoff retry.
 * Implements rate limiting and timeout protection.
 */

import { CONFIG } from './config.ts';
import { EmailResult, Car, UserProfile, NotificationType } from './types.ts';
import { logger } from './logger.ts';
import { formatDateISO } from './dateCalculator.ts';

export class EmailService {
  private resendApiKey: string;
  private emailFrom: string;

  constructor(resendApiKey: string, emailFrom: string) {
    this.resendApiKey = resendApiKey;
    this.emailFrom = emailFrom;
  }

  /**
   * Send expiry notification email with retry logic
   * 
   * Implements exponential backoff: 1s → 2s → 4s
   * Max 3 attempts before giving up.
   */
  async sendExpiryNotification(
    car: Car,
    profile: UserProfile,
    notificationType: NotificationType,
    daysUntilExpiry: number
  ): Promise<EmailResult> {
    let lastError: Error | null = null;
    let retryCount = 0;

    for (let attempt = 1; attempt <= CONFIG.RETRY.MAX_ATTEMPTS; attempt++) {
      try {
        const result = await this.sendEmailWithTimeout(
          car,
          profile,
          notificationType,
          daysUntilExpiry
        );

        logger.info('Email sent successfully', {
          carId: car.id,
          email: profile.email,
          notificationType,
          attempt,
          emailId: result.emailId,
        });

        return {
          success: true,
          emailId: result.emailId,
          retryCount: attempt - 1,
        };
      } catch (error) {
        lastError = error as Error;
        retryCount = attempt - 1;

        logger.warn('Email send failed, will retry', {
          carId: car.id,
          email: profile.email,
          notificationType,
          attempt,
          error: lastError.message,
        });

        // Don't retry on final attempt
        if (attempt < CONFIG.RETRY.MAX_ATTEMPTS) {
          const delay = this.calculateBackoffDelay(attempt);
          logger.debug('Waiting before retry', { 
            carId: car.id,
            delay,
            nextAttempt: attempt + 1 
          });
          await this.sleep(delay);
        }
      }
    }

    logger.error('Email send failed after all retries', {
      carId: car.id,
      email: profile.email,
      notificationType,
      retryCount,
      error: lastError?.message,
    });

    return {
      success: false,
      error: lastError?.message || 'Unknown error',
      retryCount,
    };
  }

  /**
   * Send email with timeout protection
   * 
   * Uses AbortSignal to ensure the request doesn't hang.
   */
  private async sendEmailWithTimeout(
    car: Car,
    profile: UserProfile,
    notificationType: NotificationType,
    daysUntilExpiry: number
  ): Promise<{ emailId: string }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      CONFIG.TIMEOUT.EMAIL_SEND_MS
    );

    try {
      const { subject, html, text } = this.buildEmailContent(
        car,
        profile,
        notificationType,
        daysUntilExpiry
      );

      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.emailFrom,
          to: profile.email,
          subject,
          html,
          text,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        let errorData: any = { message: response.statusText };
        try {
          errorData = await response.json();
        } catch {
          // Ignore JSON parse errors
        }
        throw new Error(
          `Resend API error (${response.status}): ${errorData.message || response.statusText}`
        );
      }

      const data = await response.json() as { id: string };
      if (!data.id) {
        throw new Error('Resend API returned no email ID');
      }

      return { emailId: data.id };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Build email content based on notification type
   * 
   * Creates subject line and HTML/text content tailored to the
   * notification type (pre-expiry, expiry day, or post-expiry).
   */
  private buildEmailContent(
    car: Car,
    profile: UserProfile,
    notificationType: NotificationType,
    daysUntilExpiry: number
  ): { subject: string; html: string; text: string } {
    const carInfo = `${car.vehicle_make} ${car.vehicle_model} (${car.registration_no})`;
    const greeting = `Hi ${profile.first_name}`;

    let subject: string;
    let mainMessage: string;
    let emoji: string;
    let headerColor: string;

    if (notificationType.startsWith('reminder_')) {
      const daysText = Math.abs(daysUntilExpiry) === 1 ? 'day' : 'days';
      emoji = daysUntilExpiry <= 3 ? '🚨' : '⏰';
      subject = `${emoji} Vehicle Expiry Reminder - ${Math.abs(daysUntilExpiry)} ${daysText} left`;
      mainMessage = `Your vehicle registration for <strong>${carInfo}</strong> will expire in <strong>${Math.abs(daysUntilExpiry)} ${daysText}</strong>.`;
      // Brand blue for standard reminders
      headerColor = '#1B6DBD';
    } else if (notificationType === 'expiry_day') {
      emoji = '⚠️';
      subject = `${emoji} URGENT: Vehicle Registration Expires TODAY`;
      mainMessage = `Your vehicle registration for <strong>${carInfo}</strong> expires <strong>TODAY</strong>.`;
      // Deeper brand blue for same-day urgency
      headerColor = '#165698';
    } else {
      // overdue_3d or overdue_7d
      const daysText = Math.abs(daysUntilExpiry) === 1 ? 'day' : 'days';
      emoji = '❗';
      subject = `${emoji} OVERDUE: Vehicle Registration Expired ${Math.abs(daysUntilExpiry)} ${daysText} ago`;
      mainMessage = `Your vehicle registration for <strong>${carInfo}</strong> expired <strong>${Math.abs(daysUntilExpiry)} ${daysText} ago</strong>.`;
      // Darkest brand-aligned blue for overdue
      headerColor = '#0b3b6e';
    }

    const html = this.generateHTML(
      greeting,
      mainMessage,
      car,
      new Date(car.expiry_date),
      headerColor
    );
    const text = this.generatePlainText(greeting, mainMessage, car, new Date(car.expiry_date));

    return { subject, html, text };
  }

  /**
   * Generate HTML email template
   * 
   * Creates a responsive, branded email with car details and urgency indicators.
   */
  private generateHTML(
    greeting: string,
    message: string,
    car: Car,
    expiryDate: Date,
    headerColor: string
  ): string {
    const formattedDate = expiryDate.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const year = new Date().getFullYear();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Motoka</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#ffffff;color:#111827}
    .wrap{max-width:520px;margin:0 auto;background:#ffffff}
    .top-bar{height:4px;background:${headerColor}}
    .brand{padding:22px 36px 18px;border-bottom:1px solid #e5eaf2}
    .brand img{height:26px;width:auto;display:block}
    .body{padding:32px 36px 28px}
    .title{font-size:20px;font-weight:700;color:#111827;margin-bottom:6px;letter-spacing:-0.3px}
    .sub{font-size:13.5px;color:#6b7280;margin-bottom:24px;line-height:1.55}
    table{width:100%;border-collapse:collapse;margin-bottom:24px}
    td{padding:11px 0;font-size:13.5px;border-bottom:1px solid #e5eaf2}
    tr:last-child td{border-bottom:none}
    .lbl{color:#6b7280;font-weight:500}
    .val{color:#111827;font-weight:600;text-align:right}
    .val-accent{color:${headerColor};font-weight:700;text-align:right}
    .cta{display:inline-block;background:${headerColor};color:#ffffff;padding:11px 26px;text-decoration:none;border-radius:6px;font-weight:600;font-size:13.5px;margin-bottom:24px}
    .note{font-size:12.5px;color:#9ca3af;line-height:1.6}
    .footer{border-top:1px solid #e5eaf2;padding:14px 36px;text-align:center}
    .footer p{font-size:11px;color:#c0c8d4}
    @media(max-width:480px){.body{padding:24px 20px 20px}.brand{padding:18px 20px}.footer{padding:12px 20px}}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="top-bar"></div>
    <div class="brand"><span style="font-size:22px;font-weight:800;color:#1B6DBD;letter-spacing:-0.5px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">motoka</span></div>
    <div class="body">
      <p class="title">${greeting}, action required.</p>
      <p class="sub">${message.replace(/<\/?strong>/g, '')}</p>
      <table>
        <tr><td class="lbl">Vehicle</td><td class="val">${car.vehicle_make} ${car.vehicle_model} (${car.vehicle_year})</td></tr>
        <tr><td class="lbl">Reg. No.</td><td class="val">${car.registration_no}</td></tr>
        <tr><td class="lbl">Owner</td><td class="val">${car.name_of_owner}</td></tr>
        <tr><td class="lbl">Expiry Date</td><td class="val-accent">${formattedDate}</td></tr>
      </table>
      <a href="https://motokaapp.ng/dashboard" class="cta">Renew Registration</a>
      <p class="note">Questions? <a href="mailto:rasak@motokaapp.ng" style="color:${headerColor};text-decoration:none">support@motokaapp.ng</a></p>
    </div>
    <div class="footer"><p>&copy; ${year} Motoka &mdash; Automated message, do not reply.</p></div>
  </div>
</body>
</html>`;
  }

  /**
   * Generate plain text email version
   * 
   * For email clients that don't support HTML.
   */
  private generatePlainText(
    greeting: string,
    message: string,
    car: Car,
    expiryDate: Date
  ): string {
    const formattedDate = expiryDate.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    return `
VEHICLE REGISTRATION REMINDER

${greeting},

${message.replace(/<\/?strong>/g, '')}

VEHICLE DETAILS
Owner: ${car.name_of_owner}
Vehicle: ${car.vehicle_make} ${car.vehicle_model}
Year: ${car.vehicle_year}
Registration Number: ${car.registration_no}
Expiry Date: ${formattedDate}

Please renew your vehicle registration as soon as possible to avoid penalties or legal issues.

For assistance with the renewal process, contact our support team at support@motokaapp.ng

---

© ${new Date().getFullYear()} Motoka. All rights reserved.
This is an automated reminder. Please do not reply to this email.
Motoka - Your Complete Vehicle Management Solution
    `.trim();
  }

  /**
   * Calculate exponential backoff delay
   * 
   * Prevents overwhelming the API during transient failures.
   */
  private calculateBackoffDelay(attempt: number): number {
    const delay = CONFIG.RETRY.INITIAL_DELAY_MS *
      Math.pow(CONFIG.RETRY.MULTIPLIER, attempt - 1);
    return Math.min(delay, CONFIG.RETRY.MAX_DELAY_MS);
  }

  /**
   * Sleep helper for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
