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
    let urgencyLevel: 'low' | 'medium' | 'high' | 'critical';
    let emoji: string;
    let headerColor: string;

    if (notificationType.startsWith('reminder_')) {
      const daysText = Math.abs(daysUntilExpiry) === 1 ? 'day' : 'days';
      emoji = daysUntilExpiry <= 3 ? '🚨' : '⏰';
      urgencyLevel = daysUntilExpiry <= 3 ? 'high' : daysUntilExpiry <= 7 ? 'medium' : 'low';
      subject = `${emoji} Vehicle Expiry Reminder - ${Math.abs(daysUntilExpiry)} ${daysText} left`;
      mainMessage = `Your vehicle registration for <strong>${carInfo}</strong> will expire in <strong>${Math.abs(daysUntilExpiry)} ${daysText}</strong>.`;
      headerColor = '#0066cc';
    } else if (notificationType === 'expiry_day') {
      emoji = '⚠️';
      urgencyLevel = 'critical';
      subject = `${emoji} URGENT: Vehicle Registration Expires TODAY`;
      mainMessage = `Your vehicle registration for <strong>${carInfo}</strong> expires <strong>TODAY</strong>.`;
      headerColor = '#ff6b6b';
    } else {
      // overdue_3d or overdue_7d
      const daysText = Math.abs(daysUntilExpiry) === 1 ? 'day' : 'days';
      emoji = '❗';
      urgencyLevel = 'critical';
      subject = `${emoji} OVERDUE: Vehicle Registration Expired ${Math.abs(daysUntilExpiry)} ${daysText} ago`;
      mainMessage = `Your vehicle registration for <strong>${carInfo}</strong> expired <strong>${Math.abs(daysUntilExpiry)} ${daysText} ago</strong>.`;
      headerColor = '#d32f2f';
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

    return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          margin: 0;
          padding: 0;
          background-color: #f4f4f4;
          line-height: 1.6;
        }
        .container {
          max-width: 600px;
          margin: 0 auto;
          background-color: #ffffff;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
          overflow: hidden;
        }
        .header {
          background: linear-gradient(135deg, ${headerColor} 0%, ${headerColor}dd 100%);
          color: #ffffff;
          padding: 40px 30px;
          text-align: center;
        }
        .header h1 {
          margin: 0;
          font-size: 24px;
          font-weight: 700;
          letter-spacing: -0.5px;
        }
        .content {
          padding: 40px 30px;
        }
        .message {
          font-size: 16px;
          line-height: 1.6;
          color: #333333;
          margin: 20px 0;
        }
        .car-details-box {
          background-color: #f8f9fa;
          border-left: 4px solid ${headerColor};
          border-radius: 8px;
          padding: 20px;
          margin: 25px 0;
        }
        .car-details-title {
          font-size: 14px;
          font-weight: 600;
          color: #1a1a1a;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 15px;
        }
        .car-detail-row {
          display: flex;
          justify-content: space-between;
          padding: 10px 0;
          border-bottom: 1px solid #e0e0e0;
          font-size: 14px;
        }
        .car-detail-row:last-child {
          border-bottom: none;
        }
        .car-detail-label {
          font-weight: 600;
          color: #666666;
        }
        .car-detail-value {
          color: #1a1a1a;
          font-weight: 500;
          text-align: right;
        }
        .expiry-date {
          color: ${headerColor};
          font-weight: 700;
          font-size: 16px;
        }
        .cta-button {
          display: inline-block;
          background-color: ${headerColor};
          color: #ffffff;
          padding: 14px 32px;
          text-decoration: none;
          border-radius: 6px;
          font-weight: 600;
          margin: 25px 0;
          font-size: 15px;
          border: none;
          cursor: pointer;
        }
        .cta-button:hover {
          opacity: 0.9;
        }
        .footer {
          background-color: #f8f9fa;
          padding: 25px 30px;
          text-align: center;
          font-size: 12px;
          color: #6c757d;
          border-top: 1px solid #e0e0e0;
        }
        .footer p {
          margin: 5px 0;
        }
        strong {
          color: ${headerColor};
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Vehicle Registration Reminder</h1>
        </div>
        <div class="content">
          <p class="message"><strong>${greeting},</strong></p>
          <p class="message">${message}</p>

          <div class="car-details-box">
            <div class="car-details-title">📋 Vehicle Details</div>
            <div class="car-detail-row">
              <span class="car-detail-label">Owner</span>
              <span class="car-detail-value">${car.name_of_owner}</span>
            </div>
            <div class="car-detail-row">
              <span class="car-detail-label">Vehicle</span>
              <span class="car-detail-value">${car.vehicle_make} ${car.vehicle_model}</span>
            </div>
            <div class="car-detail-row">
              <span class="car-detail-label">Year</span>
              <span class="car-detail-value">${car.vehicle_year}</span>
            </div>
            <div class="car-detail-row">
              <span class="car-detail-label">Registration Number</span>
              <span class="car-detail-value">${car.registration_no}</span>
            </div>
            <div class="car-detail-row">
              <span class="car-detail-label">Expiry Date</span>
              <span class="car-detail-value expiry-date">${formattedDate}</span>
            </div>
          </div>

          <p class="message">
            Please renew your vehicle registration as soon as possible to avoid penalties or legal issues.
          </p>

          <div style="text-align: center;">
            <a href="https://motokaapp.ng/dashboard" class="cta-button">Renew Registration</a>
          </div>

          <p class="message" style="font-size: 14px; color: #666;">
            Questions? Contact our support team at support@motokaapp.ng for assistance with the renewal process.
          </p>
        </div>
        <div class="footer">
          <p>© ${new Date().getFullYear()} Motoka. All rights reserved.</p>
          <p>This is an automated reminder. Please do not reply to this email.</p>
          <p><em>Motoka - Your Complete Vehicle Management Solution</em></p>
        </div>
      </div>
    </body>
    </html>
    `;
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
