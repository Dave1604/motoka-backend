import { body, validationResult } from 'express-validator';

export const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array().map(err => ({ field: err.path, message: err.msg }))
    });
  }
  next();
};

export const registerValidation = [
  body('first_name').trim().notEmpty().withMessage('First name is required').isLength({ min: 2, max: 50 }).withMessage('First name must be 2-50 characters'),
  body('last_name').trim().notEmpty().withMessage('Last name is required').isLength({ min: 2, max: 50 }).withMessage('Last name must be 2-50 characters'),
  body('email').trim().notEmpty().withMessage('Email is required').isEmail().withMessage('Invalid email').normalizeEmail(),
  body('phone').optional().trim().isMobilePhone('any').withMessage('Invalid phone number'),
  body('password').notEmpty().withMessage('Password is required').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('password_confirmation').notEmpty().withMessage('Password confirmation is required').custom((value, { req }) => {
    if (value !== req.body.password) throw new Error('Passwords do not match');
    return true;
  })
];

export const loginValidation = [
  body('email').trim().notEmpty().withMessage('Email is required').isEmail().withMessage('Invalid email').normalizeEmail(),
  body('password').notEmpty().withMessage('Password is required')
];

export const emailValidation = [
  body('email').trim().notEmpty().withMessage('Email is required').isEmail().withMessage('Invalid email').normalizeEmail()
];

export const otpValidation = [
  body('email').trim().notEmpty().withMessage('Email is required').isEmail().withMessage('Invalid email').normalizeEmail(),
  body('otp').trim().notEmpty().withMessage('OTP is required').isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits').isNumeric().withMessage('OTP must be numeric')
];

export const resetPasswordValidation = [
  body('email').trim().notEmpty().withMessage('Email is required').isEmail().withMessage('Invalid email').normalizeEmail(),
  body('token').trim().notEmpty().withMessage('Reset token is required'),
  body('password').notEmpty().withMessage('Password is required').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('password_confirmation').notEmpty().withMessage('Password confirmation is required').custom((value, { req }) => {
    if (value !== req.body.password) throw new Error('Passwords do not match');
    return true;
  })
];

export const twoFactorCodeValidation = [
  body('code').trim().notEmpty().withMessage('Code is required').isLength({ min: 6, max: 6 }).withMessage('Code must be 6 digits').isNumeric().withMessage('Code must be numeric')
];

export const updateProfileValidation = [
  body('first_name').optional().trim().isLength({ min: 2, max: 50 }).withMessage('First name must be 2-50 characters'),
  body('last_name').optional().trim().isLength({ min: 2, max: 50 }).withMessage('Last name must be 2-50 characters'),
  body('phone_number').optional().trim().isMobilePhone('any').withMessage('Invalid phone number'),
  body('image').optional().trim().isURL().withMessage('Invalid image URL'),
  body('nin').optional().trim().isLength({ min: 5, max: 50 }).withMessage('NIN must be 5-50 characters'),
  body('address').optional().trim().isLength({ max: 500 }).withMessage('Address must be under 500 characters'),
  body('gender').optional().trim().isIn(['male', 'female', 'other']).withMessage('Gender must be male, female, or other')
];

export const suspendUserValidation = [
  body('reason').optional().trim().isLength({ max: 500 }).withMessage('Reason must be under 500 characters')
];
