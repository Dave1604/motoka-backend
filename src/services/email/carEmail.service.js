import { sendEmail } from './email.service.js';

/**
 * CAR EMAIL SERVICE
 * 
 * Handles car-specific email notifications (welcome emails, approval notifications, etc.)
 */

/**
 * Send welcome notification email for first car registration
 * 
 * Sends an HTML-styled email with Motoka branding when a user registers their first car.
 * Includes car details (make, model, registration number) in the email.
 * 
 * @param {Object} options
 * @param {string} options.to - Recipient email
 * @param {string} options.firstName - User's first name (optional, for personalization)
 * @param {Object} options.carDetails - Car details object
 * @param {string} options.carDetails.make - Car make/manufacturer
 * @param {string} options.carDetails.model - Car model
 * @param {string} options.carDetails.registration_no - Car registration number
 * @returns {Promise<Object>} Send result
 */
export async function sendWelcomeEmail({ to, firstName, carDetails }) {
  const subject = '🎉 Welcome to Motoka!';
  const userGreeting = firstName ? `Hi ${firstName}` : 'Hello';

  const html = `
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
        }
        .container {
          max-width: 600px;
          margin: 0 auto;
          background-color: #ffffff;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }
        .header {
          background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
          color: #ffffff;
          padding: 40px 30px;
          text-align: center;
        }
        .header h1 {
          margin: 0;
          font-size: 28px;
          font-weight: 700;
          letter-spacing: -0.5px;
        }
        .emoji {
          font-size: 32px;
          margin-right: 10px;
        }
        .content {
          padding: 40px 30px;
        }
        .greeting {
          font-size: 16px;
          line-height: 1.6;
          color: #333333;
          margin: 0 0 20px 0;
        }
        .message {
          font-size: 15px;
          line-height: 1.6;
          color: #555555;
          margin: 15px 0;
        }
        .car-details-box {
          background-color: #f8f9fa;
          border: 2px solid #e9ecef;
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
        }
        .cta-button {
          display: inline-block;
          background-color: #1a1a1a;
          color: #ffffff;
          padding: 12px 30px;
          text-decoration: none;
          border-radius: 6px;
          font-weight: 600;
          margin: 25px 0;
          font-size: 14px;
        }
        .cta-button:hover {
          background-color: #2d2d2d;
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
        .celebration-text {
          font-size: 14px;
          color: #1a1a1a;
          font-weight: 600;
          margin: 20px 0;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1><span class="emoji">🎉</span>Welcome to Motoka</h1>
        </div>
        <div class="content">
          <p class="greeting"><strong>${userGreeting},</strong></p>
          
          <p class="message">
            Thanks for registering your first car with us! We're excited to have you on board. 
            Your vehicle is now registered in our system, and you're all set to manage your car with Motoka.
          </p>

          <div class="car-details-box">
            <div class="car-details-title">📋 Your Registered Vehicle</div>
            <div class="car-detail-row">
              <span class="car-detail-label">Make & Model</span>
              <span class="car-detail-value">${carDetails.make} ${carDetails.model}</span>
            </div>
            <div class="car-detail-row">
              <span class="car-detail-label">Registration Number</span>
              <span class="car-detail-value">${carDetails.registration_no}</span>
            </div>
          </div>

          <p class="celebration-text">
            ✨ You're all set! Your first car is now registered with Motoka.
          </p>

          <p class="message">
            Next steps:
            <ul style="color: #555555; line-height: 1.8;">
              <li>Complete your vehicle registration approval process</li>
              <li>Keep track of your vehicle's renewal dates</li>
              <li>Access all your vehicle documents in one place</li>
              <li>Get timely renewal reminders before expiry</li>
            </ul>
          </p>

          <p class="message">
            If you have any questions or need assistance, our support team is always here to help.
          </p>
        </div>
        <div class="footer">
          <p>© ${new Date().getFullYear()} Motoka. All rights reserved.</p>
          <p>This is an automated message, please do not reply.</p>
          <p><em>Motoka - Your Complete Vehicle Management Solution</em></p>
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `
Welcome to Motoka!

${userGreeting},

Thanks for registering your first car with us! We're excited to have you on board.

Your Registered Vehicle:
Make & Model: ${carDetails.make} ${carDetails.model}
Registration Number: ${carDetails.registration_no}

Next steps:
- Complete your vehicle registration approval process
- Keep track of your vehicle's renewal dates
- Access all your vehicle documents in one place
- Get timely renewal reminders before expiry

If you have any questions or need assistance, our support team is always here to help.

© ${new Date().getFullYear()} Motoka. All rights reserved.
  `.trim();

  return await sendEmail({ to, subject, html, text });
}
