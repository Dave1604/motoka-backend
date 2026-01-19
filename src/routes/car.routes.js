import { Router } from 'express';
import * as car from '../controllers/car.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { checkEmailVerified } from '../middleware/checkEmailVerified.js';
import { addCarValidation, updateCarValidation } from '../utils/carValidator.js';
import { validate } from '../utils/validators.js';
import { carRegistrationLimiter, apiLimiter } from '../middleware/rateLimiter.js';
import { handleCarRegistrationUploads, handleCarUpdateUploads } from '../middleware/fileUpload.js';

const router = Router();

router.post('/reg-car', authenticate, checkEmailVerified, carRegistrationLimiter, handleCarRegistrationUploads, addCarValidation, validate, car.addCar);
router.get('/get-cars', authenticate, checkEmailVerified, apiLimiter, car.getCars);
router.get('/cars/:slug', authenticate, checkEmailVerified, apiLimiter, car.getCarBySlug);
router.put('/cars/:slug', authenticate, checkEmailVerified, apiLimiter, handleCarUpdateUploads, updateCarValidation, validate, car.updateCar);
router.delete('/cars/:slug', authenticate, checkEmailVerified, apiLimiter, car.deleteCar);

export default router;
