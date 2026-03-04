import {
  getOrCreateApplication,
  updateApplication,
  getApplicationByUserId,
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

export const upsertApplication = async (req, res) => {
  try {
    const userId = req.user.id;
    const { application_type = 'new', ...updates } = req.body;
    const appType = application_type === 'renew' ? 'renew' : 'new';
    await getOrCreateApplication(userId, appType);
    const app = await updateApplication(userId, appType, updates);
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
