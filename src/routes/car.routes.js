import { Router } from 'express';
import * as car from '../controllers/car.controller.js';
import { listPlateNumberPrices } from '../controllers/platePrice.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { checkEmailVerified } from '../middleware/checkEmailVerified.js';
import { addCarValidation, updateCarValidation, applyPlateNumberValidation } from '../utils/carValidator.js';
import { validate } from '../utils/validators.js';
import { carRegistrationLimiter, apiLimiter } from '../middleware/rateLimiter.js';
import { handleCarRegistrationUploads, handleCarUpdateUploads } from '../middleware/fileUpload.js';

const router = Router();

// Plate number pricing (public to authenticated users)
router.get('/plate-number-prices', authenticate, apiLimiter, listPlateNumberPrices);

router.post('/reg-car', authenticate, checkEmailVerified, carRegistrationLimiter, handleCarRegistrationUploads, addCarValidation, validate, car.addCar);
router.get('/get-cars', authenticate, checkEmailVerified, apiLimiter, car.getCars);
router.get('/cars/:slug', authenticate, checkEmailVerified, apiLimiter, car.getCarBySlug);
router.put('/cars/:slug', authenticate, checkEmailVerified, apiLimiter, handleCarUpdateUploads, updateCarValidation, validate, car.updateCar);
router.post('/cars/:slug/plate-number', authenticate, checkEmailVerified, apiLimiter, handleCarUpdateUploads, applyPlateNumberValidation, validate, car.applyPlateNumber);
router.delete('/cars/:slug', authenticate, checkEmailVerified, apiLimiter, car.deleteCar);

export default router;
