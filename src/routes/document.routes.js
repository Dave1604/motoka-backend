import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { handleDocumentUpload } from '../middleware/fileUpload.js';
import * as document from '../controllers/document.controller.js';
import { apiLimiter } from '../middleware/rateLimiter.js';

const router = Router();

router.post(
  '/documents/upload',
  authenticate,
  apiLimiter,
  handleDocumentUpload,
  document.uploadDocument
);

router.get('/documents/car/:carSlug', authenticate, apiLimiter, document.listCarDocuments);
router.get('/documents/driver-license', authenticate, apiLimiter, document.listDriverLicenseDocuments);

export default router;
