import { CONFIG } from './config.ts';

export class ReminderEmailService {
  private resendApiKey: string;
  private emailFrom: string;
  private frontendUrl: string;

  constructor(resendApiKey: string, emailFrom: string, frontendUrl?: string) {
    this.resendApiKey = resendApiKey;
    this.emailFrom = emailFrom;
    this.frontendUrl = frontendUrl || CONFIG.defaultFrontendUrl;
  }

  async sendDeferredExpiryEmail(params: {
    to: string;
    firstName?: string | null;
    documentName: string;
    expiryDate: string;
    daysUntilExpiry: number;
    carInfo?: string | null;
  }) {
    const subject = `Reminder: Your ${params.documentName} expires in ${params.daysUntilExpiry} days - Motoka`;
    const body = `
Hello ${params.firstName || 'there'},

This is a reminder that your ${params.documentName} expires in ${params.daysUntilExpiry} days.
Expiry Date: ${params.expiryDate}
Vehicle: ${params.carInfo || 'Your vehicle'}

Renew here: ${this.frontendUrl}/licenses/renew
    `.trim();
    return this.send(params.to, subject, body);
  }

  async sendSkippedNudgeEmail(params: {
    to: string;
    firstName?: string | null;
    skippedDocNames: string[];
    nudgeDay: number;
    carInfo?: string | null;
  }) {
    const subject = "Did you forget? Some of your vehicle documents weren't renewed - Motoka";
    const docs = params.skippedDocNames.length ? params.skippedDocNames.join(', ') : 'some documents';
    const nudges: Record<number, string> = {
      1: 'Quick reminder: you skipped some document renewals in your last checkout.',
      2: 'Friendly follow-up: your skipped document renewals are still pending.',
      3: 'Final nudge: complete your skipped document renewals to stay up to date.'
    };
    const body = `
Hello ${params.firstName || 'there'},

${nudges[params.nudgeDay] || nudges[1]}
Skipped documents: ${docs}
Vehicle: ${params.carInfo || 'Your vehicle'}

Complete here: ${this.frontendUrl}/licenses/renew
    `.trim();
    return this.send(params.to, subject, body);
  }

  private async send(to: string, subject: string, text: string) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.resendApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: this.emailFrom,
        to,
        subject,
        text
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Resend error (${response.status}): ${body}`);
    }

    return response.json();
  }
}
