/**
 * PUBLIC CONTROLLER
 *
 * Exposes read-only reference data (renewal items, states, LGAs) with no
 * authentication required. All handlers delegate to the same service
 * functions used by the authenticated payment endpoints.
 */

import { getRenewalItems } from '../services/payment/renewalItems.service.js';
import { getAllStates, getLGAsByState } from '../services/location.service.js';
import { sendEmail } from '../services/email/email.service.js';
import * as response from '../utils/responses.js';
import { logError } from '../utils/logger.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTACT_INBOX = process.env.CONTACT_INBOX || 'trymotokaapp@gmail.com';

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * GET /api/public/renewal-items
 * Returns all active renewal document types with their prices.
 * Replaces HARDCODED_DOCS and HARDCODED_AMOUNT_PER_DOC in RenewModal.
 */
export const listRenewalItems = async (req, res) => {
  try {
    const items = await getRenewalItems();
    return response.success(res, items, 'Renewal items retrieved');
  } catch (error) {
    logError('[Public] listRenewalItems error', error);
    return response.serverError(res, 'Failed to retrieve renewal items');
  }
};

/**
 * GET /api/public/states
 * Returns all active states with per-state delivery fees.
 * Replaces HARDCODED_STATES and the flat HARDCODED_DELIVERY_FEE in RenewModal.
 */
export const listStates = async (req, res) => {
  try {
    const states = await getAllStates();
    return response.success(res, states, 'States retrieved');
  } catch (error) {
    logError('[Public] listStates error', error);
    return response.serverError(res, 'Failed to retrieve states');
  }
};

/**
 * GET /api/public/states/:stateCode/lgas
 * Returns LGA names for the given state code.
 * Replaces HARDCODED_LGAS in RenewModal.
 */
export const listLGAs = async (req, res) => {
  try {
    const { stateCode } = req.params;
    if (!stateCode) {
      return response.error(res, 'stateCode is required', 400);
    }
    const lgas = await getLGAsByState(stateCode.toUpperCase());
    if (!lgas || lgas.length === 0) {
      return response.notFound(res, 'No local governments found for the given state');
    }
    return response.success(res, lgas, 'Local governments retrieved');
  } catch (error) {
    logError('[Public] listLGAs error', error);
    return response.serverError(res, 'Failed to retrieve local governments');
  }
};

/**
 * POST /api/public/contact
 * Sends a website contact message to Motoka's Gmail inbox.
 * `website` is a honeypot — bots that fill it get a fake success.
 */
export const submitContact = async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const message = String(req.body?.message || '').trim();
    const honeypot = String(req.body?.website || '').trim();

    if (honeypot) {
      return response.success(res, null, 'Message sent');
    }

    const errors = {};
    if (name.length < 2 || name.length > 80) errors.name = 'Enter your name';
    if (!EMAIL_RE.test(email) || email.length > 120) errors.email = 'Enter a valid email';
    if (message.length < 10 || message.length > 2000) {
      errors.message = 'Message should be between 10 and 2000 characters';
    }
    if (Object.keys(errors).length) {
      return response.validationError(res, errors);
    }

    const safeName = escapeHtml(name);
    const safeEmail = escapeHtml(email);
    const safeMessage = escapeHtml(message).replace(/\n/g, '<br/>');

    await sendEmail({
      to: CONTACT_INBOX,
      replyTo: email,
      subject: `Motoka contact: ${name.slice(0, 60)}`,
      text: `Name: ${name}\nEmail: ${email}\n\n${message}`,
      html: `
        <p><strong>Name:</strong> ${safeName}</p>
        <p><strong>Email:</strong> ${safeEmail}</p>
        <p><strong>Message:</strong></p>
        <p>${safeMessage}</p>
      `,
    });

    return response.success(res, null, 'Message sent');
  } catch (error) {
    logError('[Public] submitContact error', error);
    return response.serverError(res, 'Could not send your message. Please try again.');
  }
};
