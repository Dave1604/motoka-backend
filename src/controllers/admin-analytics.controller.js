import { getTrafficReport, GA4NotConfiguredError } from '../services/analytics/ga4.service.js';
import { logError } from '../utils/logger.js';

// GET /api/admin/analytics/traffic?days=7
export const getTrafficReportHandler = async (req, res) => {
  try {
    const report = await getTrafficReport(req.query?.days);
    return res.json({ status: true, data: report });
  } catch (error) {
    if (error instanceof GA4NotConfiguredError) {
      return res.status(503).json({ status: false, message: error.message });
    }
    logError('[Admin Analytics] Traffic report failed', { error: error.message });
    return res.status(502).json({
      status: false,
      message: 'Could not fetch traffic data from Google Analytics.',
    });
  }
};
