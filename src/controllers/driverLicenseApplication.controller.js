import {
  getOrCreateApplication,
  updateApplication,
  getApplicationByUserId,
  renewApplicationCycle,
} from '../services/driverLicenseApplication.service.js';
import { logError } from '../utils/logger.js';

export const getMyApplication = async (req, res) => {
  try {
    const userId = req.user.id;
    const { type } = req.query;
    const applicationType = type === 'renew' ? 'renew' : 'new';
    const app = await getApplicationByUserId(userId, applicationType);
    return res.status(200).json({
      status: true,
      message: 'Application retrieved',
      data: app,
    });
  } catch (error) {
    logError('Get driver license application', error);
    return res.status(500).json({ status: false, message: 'Failed to retrieve application' });
  }
};

// Minimum fields that must be present for an application to move to 'submitted'.
// We check the merged state (existing + new updates) so partial saves stay as 'draft'.
const SUBMIT_REQUIRED_NEW    = ['full_name', 'phone', 'passport_photo_url'];
const SUBMIT_REQUIRED_RENEW  = ['license_number', 'date_of_birth', 'date_of_expiry', 'license_document_url'];

export const upsertApplication = async (req, res) => {
  try {
    const userId = req.user.id;
    const { application_type = 'new', ...updates } = req.body;
    const appType = application_type === 'renew' ? 'renew' : 'new';

    // Ensure the row exists (creates a 'draft' if first time)
    const existing = await getOrCreateApplication(userId, appType);

    // Merge existing data with incoming updates to evaluate completeness
    const merged = { ...existing, ...updates };
    const required = appType === 'renew' ? SUBMIT_REQUIRED_RENEW : SUBMIT_REQUIRED_NEW;
    const isComplete = required.every(f => merged[f]);

    // Only advance to 'submitted' — never allow downgrade via this endpoint.
    // Approved/expired status is managed server-side only.
    const currentStatus = existing.status || 'draft';
    const serverFields = {};
    if (isComplete && currentStatus === 'draft') {
      serverFields.status = 'submitted';
    }

    const app = await updateApplication(userId, appType, updates, serverFields);
    return res.status(200).json({
      status: true,
      message: 'Application saved',
      data: app,
    });
  } catch (error) {
    logError('Upsert driver license application', error);
    return res.status(500).json({ status: false, message: 'Failed to save application' });
  }
};

/**
 * POST /driver-license-applications/me/restart
 * Archives the current approved/rejected application and starts a fresh draft.
 * Only allowed when the current application is approved or rejected.
 */
export const restartApplication = async (req, res) => {
  try {
    const userId = req.user.id;
    const { application_type = 'new' } = req.body;
    const appType = application_type === 'renew' ? 'renew' : 'new';

    const current = await getApplicationByUserId(userId, appType);
    if (!current) {
      // No existing application — just create a fresh draft
      const app = await getOrCreateApplication(userId, appType);
      return res.status(200).json({ status: true, message: 'Fresh application started', data: app });
    }

    const allowedStatuses = ['approved', 'rejected'];
    if (!allowedStatuses.includes(current.status)) {
      return res.status(409).json({
        status: false,
        message: `Cannot restart an application with status "${current.status}". Only approved or rejected applications can be restarted.`,
      });
    }

    const app = await renewApplicationCycle(userId, appType);
    return res.status(200).json({ status: true, message: 'Application restarted', data: app });
  } catch (error) {
    logError('Restart driver license application', error);
    return res.status(500).json({ status: false, message: 'Failed to restart application' });
  }
};
