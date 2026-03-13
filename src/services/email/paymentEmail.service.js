/**
 * PAYMENT EMAIL SERVICE
 * 
 * Email templates for payment-related notifications:
 * - Payment success
 * - Payment failure
 * - Subscription created
 * - Subscription renewal
 * - Subscription cancelled
 */

import { sendEmail } from './email.service.js';
import { formatAmount } from '../../utils/paymentHelpers.js';

/**
 * Send payment success email
 * 
 * @param {Object} options
 * @param {string} options.to - Recipient email
 * @param {string} options.firstName - User's first name
 * @param {number} options.amount - Payment amount in kobo
 * @param {string} options.reference - Transaction reference
 * @param {string} options.orderNumber - Order number created
 * @param {Object} options.carDetails - Car information
 */
export async function sendPaymentSuccessEmail({ to, firstName, amount, reference, orderNumber, carDetails, documentNames, paymentType }) {
  const subject = 'Payment Successful - Motoka';
  const isPlateNumber = paymentType === 'plate_number';
  const isDriverLicense = paymentType === 'driver_license';
  
  const carInfo = carDetails 
    ? `${carDetails.vehicle_make || ''} ${carDetails.vehicle_model || ''} (${carDetails.registration_no || 'N/A'})`.trim()
    : (isDriverLicense ? 'Driver\'s license' : 'Your vehicle');

  const bodyIntro = isDriverLicense
    ? 'Your payment has been processed successfully. Your driver\'s license application has been received and is being processed by our team.'
    : isPlateNumber
      ? 'Your payment has been processed successfully. Your plate number application has been received and is being processed by our team.'
      : 'Your payment has been processed successfully. A renewal order has been created and is being processed by our team.';

  const bodyOutro = isDriverLicense
    ? "Our team will process your driver's license application and you'll receive a confirmation once it's ready."
    : isPlateNumber
      ? "Our team will process your plate number application and you'll receive a confirmation once it's ready."
      : "Your vehicle documents will be renewed and you'll receive a confirmation once the process is complete.";

  const serviceLabel = (isPlateNumber || isDriverLicense) ? 'Service' : 'Documents';
  const serviceValue = isDriverLicense
    ? "Driver's License (New/Renew)"
    : isPlateNumber
      ? 'Plate Number Application'
      : (documentNames?.length > 0 ? documentNames.join(', ') : null);
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f4f4; }
        .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; }
        .header { background-color: #22c55e; color: #ffffff; padding: 30px 20px; text-align: center; }
        .header h1 { margin: 0; font-size: 24px; }
        .content { padding: 40px 30px; }
        .amount-box { background-color: #f0fdf4; border: 2px solid #22c55e; border-radius: 8px; padding: 20px; text-align: center; margin: 30px 0; }
        .amount { font-size: 32px; font-weight: bold; color: #16a34a; }
        .details { background-color: #f8f9fa; border-radius: 8px; padding: 20px; margin: 20px 0; }
        .detail-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e9ecef; }
        .detail-row:last-child { border-bottom: none; }
        .detail-label { color: #6c757d; }
        .detail-value { font-weight: 600; color: #1a1a1a; }
        .footer { background-color: #f8f9fa; padding: 20px; text-align: center; font-size: 12px; color: #6c757d; }
        .cta-button { display: inline-block; background-color: #1a1a1a; color: #ffffff; padding: 14px 28px; border-radius: 6px; text-decoration: none; font-weight: 600; margin-top: 20px; }
        .success-icon { font-size: 48px; margin-bottom: 10px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="success-icon">✓</div>
          <h1>Payment Successful!</h1>
        </div>
        <div class="content">
          <p>Hello ${firstName || 'there'},</p>
          <p>${bodyIntro}</p>
          
          <div class="amount-box">
            <div class="amount">${formatAmount(amount)}</div>
            <div style="color: #6c757d; margin-top: 5px;">Amount Paid</div>
          </div>
          
          <div class="details">
            <div class="detail-row">
              <span class="detail-label">Reference</span>
              <span class="detail-value">${reference}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Order Number</span>
              <span class="detail-value">${orderNumber}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Vehicle</span>
              <span class="detail-value">${carInfo}</span>
            </div>
            ${serviceValue ? `
            <div class="detail-row">
              <span class="detail-label">${serviceLabel}</span>
              <span class="detail-value">${serviceValue}</span>
            </div>` : ''}
            <div class="detail-row">
              <span class="detail-label">Status</span>
              <span class="detail-value" style="color: #22c55e;">Processing</span>
            </div>
          </div>
          
          <p>${bodyOutro}</p>
          
          <center>
            <a href="${process.env.FRONTEND_URL}/orders/${orderNumber}" class="cta-button">View Order Details</a>
          </center>
        </div>
        <div class="footer">
          <p>Thank you for using Motoka!</p>
          <p>If you have any questions, please contact our support team.</p>
          <p style="margin-top: 15px; color: #9ca3af;">© ${new Date().getFullYear()} Motoka. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `
Payment Successful!

Hello ${firstName || 'there'},

Your payment of ${formatAmount(amount)} has been processed successfully.

Reference: ${reference}
Order Number: ${orderNumber}
Vehicle: ${carInfo}
${serviceValue ? `${serviceLabel}: ${serviceValue}\n` : ''}
${bodyOutro}

Thank you for using Motoka!
  `.trim();

  return sendEmail({ to, subject, html, text });
}

/**
 * Send payment failed email
 * 
 * @param {Object} options
 * @param {string} options.to - Recipient email
 * @param {string} options.firstName - User's first name
 * @param {number} options.amount - Payment amount attempted
 * @param {string} options.reference - Transaction reference
 * @param {Object} options.carDetails - Car information
 */
export async function sendPaymentFailedEmail({ to, firstName, amount, reference, carDetails }) {
  const subject = 'Payment Failed - Motoka';
  
  const carInfo = carDetails 
    ? `${carDetails.vehicle_make || ''} ${carDetails.vehicle_model || ''} (${carDetails.registration_no || 'N/A'})`.trim()
    : 'Your vehicle';
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f4f4; }
        .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; }
        .header { background-color: #ef4444; color: #ffffff; padding: 30px 20px; text-align: center; }
        .header h1 { margin: 0; font-size: 24px; }
        .content { padding: 40px 30px; }
        .amount-box { background-color: #fef2f2; border: 2px solid #ef4444; border-radius: 8px; padding: 20px; text-align: center; margin: 30px 0; }
        .amount { font-size: 32px; font-weight: bold; color: #dc2626; text-decoration: line-through; }
        .details { background-color: #f8f9fa; border-radius: 8px; padding: 20px; margin: 20px 0; }
        .detail-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e9ecef; }
        .detail-row:last-child { border-bottom: none; }
        .detail-label { color: #6c757d; }
        .detail-value { font-weight: 600; color: #1a1a1a; }
        .footer { background-color: #f8f9fa; padding: 20px; text-align: center; font-size: 12px; color: #6c757d; }
        .cta-button { display: inline-block; background-color: #1a1a1a; color: #ffffff; padding: 14px 28px; border-radius: 6px; text-decoration: none; font-weight: 600; margin-top: 20px; }
        .error-icon { font-size: 48px; margin-bottom: 10px; }
        .tips { background-color: #fffbeb; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="error-icon">✕</div>
          <h1>Payment Failed</h1>
        </div>
        <div class="content">
          <p>Hello ${firstName || 'there'},</p>
          <p>Unfortunately, your payment could not be processed. No charges have been made to your account.</p>
          
          <div class="amount-box">
            <div class="amount">${formatAmount(amount)}</div>
            <div style="color: #6c757d; margin-top: 5px;">Payment Not Processed</div>
          </div>
          
          <div class="details">
            <div class="detail-row">
              <span class="detail-label">Reference</span>
              <span class="detail-value">${reference}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Vehicle</span>
              <span class="detail-value">${carInfo}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Status</span>
              <span class="detail-value" style="color: #ef4444;">Failed</span>
            </div>
          </div>
          
          <div class="tips">
            <strong>💡 Tips:</strong>
            <ul style="margin: 10px 0 0 0; padding-left: 20px;">
              <li>Check that your card has sufficient funds</li>
              <li>Ensure your card is enabled for online payments</li>
              <li>Try using a different payment method</li>
              <li>Contact your bank if the issue persists</li>
            </ul>
          </div>
          
          <center>
            <a href="${process.env.FRONTEND_URL}/cars" class="cta-button">Try Again</a>
          </center>
        </div>
        <div class="footer">
          <p>Need help? Contact our support team.</p>
          <p style="margin-top: 15px; color: #9ca3af;">© ${new Date().getFullYear()} Motoka. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `
Payment Failed

Hello ${firstName || 'there'},

Unfortunately, your payment of ${formatAmount(amount)} could not be processed. No charges have been made to your account.

Reference: ${reference}
Vehicle: ${carInfo}

Please try again or use a different payment method.

Need help? Contact our support team.
  `.trim();

  return sendEmail({ to, subject, html, text });
}

/**
 * Send subscription created email
 * 
 * @param {Object} options
 * @param {string} options.to - Recipient email
 * @param {string} options.firstName - User's first name
 * @param {string} options.subscriptionCode - Subscription identifier
 * @param {number} options.amount - Subscription amount
 * @param {string} options.plan - Subscription plan (annual/monthly)
 * @param {Object} options.carDetails - Car information
 * @param {string} options.nextBillingDate - Next billing date
 */
export async function sendSubscriptionCreatedEmail({ 
  to, firstName, subscriptionCode, amount, plan, carDetails, nextBillingDate 
}) {
  const subject = 'Auto-Renewal Subscription Activated - Motoka';
  
  const carInfo = carDetails 
    ? `${carDetails.vehicle_make || ''} ${carDetails.vehicle_model || ''} (${carDetails.registration_no || 'N/A'})`.trim()
    : 'Your vehicle';
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f4f4; }
        .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; }
        .header { background-color: #6366f1; color: #ffffff; padding: 30px 20px; text-align: center; }
        .header h1 { margin: 0; font-size: 24px; }
        .content { padding: 40px 30px; }
        .subscription-box { background-color: #eef2ff; border: 2px solid #6366f1; border-radius: 8px; padding: 20px; text-align: center; margin: 30px 0; }
        .details { background-color: #f8f9fa; border-radius: 8px; padding: 20px; margin: 20px 0; }
        .detail-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e9ecef; }
        .detail-row:last-child { border-bottom: none; }
        .detail-label { color: #6c757d; }
        .detail-value { font-weight: 600; color: #1a1a1a; }
        .footer { background-color: #f8f9fa; padding: 20px; text-align: center; font-size: 12px; color: #6c757d; }
        .cta-button { display: inline-block; background-color: #1a1a1a; color: #ffffff; padding: 14px 28px; border-radius: 6px; text-decoration: none; font-weight: 600; margin-top: 20px; }
        .sub-icon { font-size: 48px; margin-bottom: 10px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="sub-icon">🔄</div>
          <h1>Auto-Renewal Activated!</h1>
        </div>
        <div class="content">
          <p>Hello ${firstName || 'there'},</p>
          <p>Great news! Your auto-renewal subscription has been activated. Your vehicle documents will be automatically renewed, so you never have to worry about expiry dates again.</p>
          
          <div class="subscription-box">
            <div style="font-size: 24px; font-weight: bold; color: #4f46e5;">${formatAmount(amount)}<span style="font-size: 14px; color: #6c757d;">/${plan === 'annual' ? 'year' : 'month'}</span></div>
            <div style="color: #6c757d; margin-top: 5px;">Auto-Renewal Amount</div>
          </div>
          
          <div class="details">
            <div class="detail-row">
              <span class="detail-label">Subscription ID</span>
              <span class="detail-value">${subscriptionCode}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Vehicle</span>
              <span class="detail-value">${carInfo}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Plan</span>
              <span class="detail-value">${plan === 'annual' ? 'Annual' : 'Monthly'}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Next Billing</span>
              <span class="detail-value">${nextBillingDate || 'Upon expiry'}</span>
            </div>
          </div>
          
          <p style="color: #6c757d; font-size: 14px;">You can manage or cancel your subscription at any time from your account settings.</p>
          
          <center>
            <a href="${process.env.FRONTEND_URL}/subscriptions" class="cta-button">Manage Subscription</a>
          </center>
        </div>
        <div class="footer">
          <p>Thank you for choosing Motoka Auto-Renewal!</p>
          <p style="margin-top: 15px; color: #9ca3af;">© ${new Date().getFullYear()} Motoka. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `
Auto-Renewal Subscription Activated!

Hello ${firstName || 'there'},

Your auto-renewal subscription has been activated for ${carInfo}.

Subscription ID: ${subscriptionCode}
Amount: ${formatAmount(amount)}/${plan === 'annual' ? 'year' : 'month'}
Next Billing: ${nextBillingDate || 'Upon expiry'}

You can manage or cancel your subscription at any time from your account.

Thank you for choosing Motoka Auto-Renewal!
  `.trim();

  return sendEmail({ to, subject, html, text });
}

/**
 * Send subscription cancelled email
 * 
 * @param {Object} options
 * @param {string} options.to - Recipient email
 * @param {string} options.firstName - User's first name
 * @param {string} options.subscriptionCode - Subscription identifier
 * @param {Object} options.carDetails - Car information
 */
export async function sendSubscriptionCancelledEmail({ to, firstName, subscriptionCode, carDetails }) {
  const subject = 'Auto-Renewal Subscription Cancelled - Motoka';
  
  const carInfo = carDetails 
    ? `${carDetails.vehicle_make || ''} ${carDetails.vehicle_model || ''} (${carDetails.registration_no || 'N/A'})`.trim()
    : 'Your vehicle';
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f4f4; }
        .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; }
        .header { background-color: #6b7280; color: #ffffff; padding: 30px 20px; text-align: center; }
        .header h1 { margin: 0; font-size: 24px; }
        .content { padding: 40px 30px; }
        .notice-box { background-color: #f3f4f6; border: 2px solid #9ca3af; border-radius: 8px; padding: 20px; text-align: center; margin: 30px 0; }
        .details { background-color: #f8f9fa; border-radius: 8px; padding: 20px; margin: 20px 0; }
        .detail-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e9ecef; }
        .detail-row:last-child { border-bottom: none; }
        .detail-label { color: #6c757d; }
        .detail-value { font-weight: 600; color: #1a1a1a; }
        .footer { background-color: #f8f9fa; padding: 20px; text-align: center; font-size: 12px; color: #6c757d; }
        .cta-button { display: inline-block; background-color: #6366f1; color: #ffffff; padding: 14px 28px; border-radius: 6px; text-decoration: none; font-weight: 600; margin-top: 20px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Subscription Cancelled</h1>
        </div>
        <div class="content">
          <p>Hello ${firstName || 'there'},</p>
          <p>Your auto-renewal subscription has been cancelled as requested. You will no longer be charged automatically.</p>
          
          <div class="notice-box">
            <div style="font-size: 18px; color: #4b5563;">Auto-Renewal Disabled</div>
            <div style="color: #9ca3af; margin-top: 5px;">No future charges will be made</div>
          </div>
          
          <div class="details">
            <div class="detail-row">
              <span class="detail-label">Subscription ID</span>
              <span class="detail-value">${subscriptionCode}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Vehicle</span>
              <span class="detail-value">${carInfo}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Status</span>
              <span class="detail-value" style="color: #6b7280;">Cancelled</span>
            </div>
          </div>
          
          <p style="color: #6c757d; font-size: 14px;"><strong>Remember:</strong> You'll need to manually renew your vehicle documents before they expire to avoid penalties.</p>
          
          <center>
            <a href="${process.env.FRONTEND_URL}/subscriptions" class="cta-button">Reactivate Auto-Renewal</a>
          </center>
        </div>
        <div class="footer">
          <p>We're sorry to see you go. You can reactivate auto-renewal anytime.</p>
          <p style="margin-top: 15px; color: #9ca3af;">© ${new Date().getFullYear()} Motoka. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `
Subscription Cancelled

Hello ${firstName || 'there'},

Your auto-renewal subscription has been cancelled as requested.

Subscription ID: ${subscriptionCode}
Vehicle: ${carInfo}
Status: Cancelled

Remember: You'll need to manually renew your vehicle documents before they expire.

You can reactivate auto-renewal anytime from your account.
  `.trim();

  return sendEmail({ to, subject, html, text });
}

/**
 * Send payment confirmation email to a guest (unauthenticated) customer.
 *
 * @param {Object} options
 * @param {string} options.to           - Guest email
 * @param {string} options.guestName    - Guest full name
 * @param {string} options.reference    - Payment reference
 * @param {number} options.amount       - Total amount paid (kobo)
 * @param {string} options.plateNumber  - Vehicle plate number
 * @param {string[]} options.documentNames - List of renewed document names
 * @param {string} options.receiptUrl   - Direct link to the receipt page
 */
export async function sendGuestPaymentConfirmationEmail({
  to, guestName, reference, amount, plateNumber, documentNames = [], receiptUrl
}) {
  const subject = 'Payment Confirmed – Your Motoka Renewal';
  const firstName = guestName?.split(' ')[0] || 'there';
  const docList = documentNames.length > 0
    ? documentNames.map(d => `<li style="padding:4px 0;">${d}</li>`).join('')
    : '<li>Vehicle Document Renewal</li>';

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f5fc; }
        .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; }
        .header { background-color: #104675; color: #ffffff; padding: 32px 24px; text-align: center; }
        .header h1 { margin: 0 0 6px; font-size: 22px; }
        .header p { margin: 0; font-size: 14px; opacity: 0.75; }
        .badge { display: inline-block; background: #ffffff22; border-radius: 50%; width: 56px; height: 56px; line-height: 56px; font-size: 28px; margin-bottom: 14px; }
        .content { padding: 36px 28px; }
        .amount-box { background-color: #eef6ff; border: 2px solid #2389E3; border-radius: 10px; padding: 20px; text-align: center; margin: 24px 0; }
        .amount { font-size: 34px; font-weight: 700; color: #104675; }
        .details { background-color: #f9fafc; border-radius: 10px; padding: 20px; margin: 20px 0; }
        .detail-row { display: flex; justify-content: space-between; padding: 9px 0; border-bottom: 1px solid #e8eaf0; font-size: 14px; }
        .detail-row:last-child { border-bottom: none; }
        .detail-label { color: #697c8c; }
        .detail-value { font-weight: 600; color: #05243f; text-align: right; }
        .doc-list { margin: 0; padding-left: 20px; color: #05243f; font-size: 14px; }
        .cta-button { display: inline-block; background-color: #2389E3; color: #ffffff; padding: 13px 28px; border-radius: 50px; text-decoration: none; font-weight: 600; font-size: 14px; margin-top: 20px; }
        .tip-box { background-color: #fffbeb; border-left: 4px solid #f59e0b; padding: 14px 16px; border-radius: 4px; margin: 20px 0; font-size: 13px; color: #78350f; }
        .footer { background-color: #f4f5fc; padding: 20px; text-align: center; font-size: 12px; color: #9ca3af; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="badge">✓</div>
          <h1>Payment Confirmed!</h1>
          <p>Your vehicle document renewal has been received</p>
        </div>
        <div class="content">
          <p>Hello ${firstName},</p>
          <p>We've received your payment and your renewal request is now being processed. Here's a summary of your transaction:</p>

          <div class="amount-box">
            <div class="amount">${formatAmount(amount)}</div>
            <div style="color:#697c8c;margin-top:6px;font-size:13px;">Total Paid</div>
          </div>

          <div class="details">
            <div class="detail-row">
              <span class="detail-label">Reference</span>
              <span class="detail-value" style="font-family:monospace;">${reference}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Plate Number</span>
              <span class="detail-value">${plateNumber}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Documents</span>
              <span class="detail-value">
                <ul class="doc-list">${docList}</ul>
              </span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Status</span>
              <span class="detail-value" style="color:#22c55e;">Payment Received ✓</span>
            </div>
          </div>

          <div class="tip-box">
            💡 <strong>Tip:</strong> Create a free Motoka account to track your documents, get expiry reminders, and manage renewals in one place.
          </div>

          ${receiptUrl ? `<center><a href="${receiptUrl}" class="cta-button">View Your Receipt</a></center>` : ''}
        </div>
        <div class="footer">
          <p>Thank you for using Motoka!</p>
          <p>If you have any questions, reply to this email or contact our support team.</p>
          <p style="margin-top:12px;">© ${new Date().getFullYear()} Motoka. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `
Payment Confirmed – Motoka

Hello ${firstName},

Your payment of ${formatAmount(amount)} has been received.

Reference   : ${reference}
Plate Number: ${plateNumber}
Documents   : ${documentNames.join(', ') || 'Vehicle Document Renewal'}
Status      : Payment Received

${receiptUrl ? `View your receipt: ${receiptUrl}` : ''}

Thank you for using Motoka!
  `.trim();

  return sendEmail({ to, subject, html, text });
}

/**
 * Send order completed email (when admin finishes processing)
 * 
 * @param {Object} options
 * @param {string} options.to - Recipient email
 * @param {string} options.firstName - User's first name
 * @param {string} options.orderNumber - Order number
 * @param {Object} options.carDetails - Car information
 * @param {string} options.newExpiryDate - New document expiry date
 */
export async function sendOrderCompletedEmail({ to, firstName, orderNumber, carDetails, newExpiryDate }) {
  const subject = 'Document Renewal Complete - Motoka';
  
  const carInfo = carDetails 
    ? `${carDetails.vehicle_make || ''} ${carDetails.vehicle_model || ''} (${carDetails.registration_no || 'N/A'})`.trim()
    : 'Your vehicle';
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f4f4; }
        .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; }
        .header { background-color: #22c55e; color: #ffffff; padding: 30px 20px; text-align: center; }
        .header h1 { margin: 0; font-size: 24px; }
        .content { padding: 40px 30px; }
        .success-box { background-color: #f0fdf4; border: 2px solid #22c55e; border-radius: 8px; padding: 30px; text-align: center; margin: 30px 0; }
        .details { background-color: #f8f9fa; border-radius: 8px; padding: 20px; margin: 20px 0; }
        .detail-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e9ecef; }
        .detail-row:last-child { border-bottom: none; }
        .detail-label { color: #6c757d; }
        .detail-value { font-weight: 600; color: #1a1a1a; }
        .footer { background-color: #f8f9fa; padding: 20px; text-align: center; font-size: 12px; color: #6c757d; }
        .cta-button { display: inline-block; background-color: #1a1a1a; color: #ffffff; padding: 14px 28px; border-radius: 6px; text-decoration: none; font-weight: 600; margin-top: 20px; }
        .checkmark { font-size: 60px; margin-bottom: 15px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Renewal Complete!</h1>
        </div>
        <div class="content">
          <p>Hello ${firstName || 'there'},</p>
          <p>Great news! Your vehicle document renewal has been processed and completed successfully.</p>
          
          <div class="success-box">
            <div class="checkmark">✅</div>
            <div style="font-size: 20px; font-weight: bold; color: #16a34a;">Documents Renewed</div>
            <div style="color: #6c757d; margin-top: 10px;">Your vehicle is all set!</div>
          </div>
          
          <div class="details">
            <div class="detail-row">
              <span class="detail-label">Order Number</span>
              <span class="detail-value">${orderNumber}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Vehicle</span>
              <span class="detail-value">${carInfo}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">New Expiry Date</span>
              <span class="detail-value" style="color: #22c55e;">${newExpiryDate || 'Updated'}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Status</span>
              <span class="detail-value" style="color: #22c55e;">Completed</span>
            </div>
          </div>
          
          <center>
            <a href="${process.env.FRONTEND_URL}/cars" class="cta-button">View Your Vehicles</a>
          </center>
        </div>
        <div class="footer">
          <p>Thank you for using Motoka!</p>
          <p style="margin-top: 15px; color: #9ca3af;">© ${new Date().getFullYear()} Motoka. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `
Document Renewal Complete!

Hello ${firstName || 'there'},

Your vehicle document renewal has been processed and completed successfully.

Order Number: ${orderNumber}
Vehicle: ${carInfo}
New Expiry Date: ${newExpiryDate || 'Updated'}
Status: Completed

Your vehicle is all set!

Thank you for using Motoka!
  `.trim();

  return sendEmail({ to, subject, html, text });
}
