import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';

// Mock modules before importing routes
const mockSupabaseUser = {
  from: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  is: jest.fn().mockReturnThis(),
  neq: jest.fn().mockReturnThis(),
  single: jest.fn(),
  order: jest.fn().mockReturnThis(),
  range: jest.fn().mockReturnThis(),
};

const mockSupabaseAdmin = {
  from: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
};

const mockUploadFile = jest.fn();
const mockUploadFiles = jest.fn();
const mockDeleteFiles = jest.fn();
const mockCheckCarDuplicates = jest.fn();

// Mock Supabase config
jest.unstable_mockModule('../config/supabase.js', () => ({
  getSupabaseUser: jest.fn(() => mockSupabaseUser),
  getSupabaseAdmin: jest.fn(() => mockSupabaseAdmin),
  getSupabase: jest.fn(() => mockSupabaseUser),
}));

// Mock file upload service
jest.unstable_mockModule('../services/fileUpload.service.js', () => ({
  uploadFile: mockUploadFile,
  uploadFiles: mockUploadFiles,
  deleteFile: jest.fn(),
  deleteFiles: mockDeleteFiles,
}));

// Mock car duplicate checker
jest.unstable_mockModule('../services/carDuplicateChecker.js', () => ({
  checkCarDuplicates: mockCheckCarDuplicates,
}));

// Mock rate limiter
jest.unstable_mockModule('../middleware/rateLimiter.js', () => ({
  apiLimiter: (req, res, next) => next(),
  carRegistrationLimiter: (req, res, next) => next(),
}));

// Mock file upload middleware
jest.unstable_mockModule('../middleware/fileUpload.js', () => ({
  handleCarRegistrationUploads: (req, res, next) => {
    req.uploadedFiles = req.uploadedFiles || {};
    next();
  },
  handleCarUpdateUploads: (req, res, next) => {
    req.uploadedFiles = req.uploadedFiles || {};
    next();
  },
}));

// Mock authentication middleware
jest.unstable_mockModule('../middleware/authenticate.js', () => ({
  authenticate: (req, res, next) => {
    if (req.headers.authorization === 'Bearer valid-token') {
      req.user = {
        id: 'user-123',
        email: 'test@example.com',
        email_confirmed_at: '2024-01-01T00:00:00Z',
        profile: {
          id: 'user-123',
          is_suspended: false,
          deleted_at: null,
        },
      };
      req.token = 'valid-token';
      return next();
    }
    if (req.headers.authorization === 'Bearer unverified-token') {
      req.user = {
        id: 'user-123',
        email: 'test@example.com',
        email_confirmed_at: null,
        profile: {
          id: 'user-123',
          is_suspended: false,
          deleted_at: null,
        },
      };
      req.token = 'unverified-token';
      return next();
    }
    if (req.headers.authorization === 'Bearer other-user-token') {
      req.user = {
        id: 'other-user-456',
        email: 'other@example.com',
        email_confirmed_at: '2024-01-01T00:00:00Z',
        profile: {
          id: 'other-user-456',
          is_suspended: false,
          deleted_at: null,
        },
      };
      req.token = 'other-user-token';
      return next();
    }
    return res.status(401).json({ success: false, message: 'No token provided' });
  },
}));

// Mock email verification middleware
jest.unstable_mockModule('../middleware/checkEmailVerified.js', () => ({
  checkEmailVerified: (req, res, next) => {
    if (!req.user) {
      return res.status(403).json({ success: false, message: 'Authentication required' });
    }
    if (!req.user.email_confirmed_at) {
      return res.status(403).json({ success: false, message: 'Please verify your email address' });
    }
    next();
  },
}));

// Now import routes after mocks are set up
const carRoutes = (await import('../routes/car.routes.js')).default;

// Create test app
const createTestApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api', carRoutes);
  return app;
};

// Test data factories
const createTestCar = (overrides = {}) => ({
  id: 1,
  slug: '550e8400-e29b-41d4-a716-446655440000',
  user_id: 'user-123',
  name_of_owner: 'John Doe',
  phone_number: '+2348012345678',
  address: '123 Main St, City, State',
  vehicle_make: 'Toyota',
  vehicle_model: 'Camry',
  vehicle_year: 2020,
  vehicle_color: 'Blue',
  car_type: 'private',
  registration_no: 'ABC123XY',
  chasis_no: 'CH123456',
  engine_no: 'EN123456',
  status: 'pending',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  deleted_at: null,
  ...overrides,
});

const createValidCarData = (overrides = {}) => ({
  name_of_owner: 'John Doe',
  address: '123 Main St, City, State',
  phone_number: '+2348012345678',
  vehicle_make: 'Toyota',
  vehicle_model: 'Camry',
  vehicle_year: 2020,
  vehicle_color: 'Blue',
  car_type: 'private',
  registration_status: 'unregistered',
  registration_no: 'ABC123XY',
  chasis_no: 'CH123456',
  engine_no: 'EN123456',
  ...overrides,
});

describe('Car Endpoints', () => {
  let app;

  beforeEach(() => {
    app = createTestApp();
    jest.clearAllMocks();
    
    // Reset Supabase mocks
    mockSupabaseUser.from.mockReturnThis();
    mockSupabaseUser.select.mockReturnThis();
    mockSupabaseUser.insert.mockReturnThis();
    mockSupabaseUser.update.mockReturnThis();
    mockSupabaseUser.eq.mockReturnThis();
    mockSupabaseUser.is.mockReturnThis();
    mockSupabaseUser.order.mockReturnThis();
    mockSupabaseUser.range.mockReturnThis();
    
    // Reset service mocks
    mockCheckCarDuplicates.mockResolvedValue({ hasDuplicates: false });
    mockUploadFile.mockResolvedValue('https://example.com/file.jpg');
    mockUploadFiles.mockResolvedValue(['https://example.com/file1.jpg']);
    mockDeleteFiles.mockResolvedValue();
  });

  describe('Authentication Tests', () => {
    describe('POST /api/reg-car', () => {
      it('should return 401 when Authorization header is missing', async () => {
        const response = await request(app)
          .post('/api/reg-car')
          .send(createValidCarData());

        expect(response.status).toBe(401);
        expect(response.body.success).toBe(false);
        expect(response.body.message).toBe('No token provided');
      });

      it('should return 403 when email is not verified', async () => {
        const response = await request(app)
          .post('/api/reg-car')
          .set('Authorization', 'Bearer unverified-token')
          .send(createValidCarData());

        expect(response.status).toBe(403);
        expect(response.body.success).toBe(false);
        expect(response.body.message).toBe('Please verify your email address');
      });
    });

    describe('GET /api/get-cars', () => {
      it('should return 401 when Authorization header is missing', async () => {
        const response = await request(app).get('/api/get-cars');

        expect(response.status).toBe(401);
        expect(response.body.success).toBe(false);
      });

      it('should return 403 when email is not verified', async () => {
        const response = await request(app)
          .get('/api/get-cars')
          .set('Authorization', 'Bearer unverified-token');

        expect(response.status).toBe(403);
        expect(response.body.success).toBe(false);
      });
    });

    describe('GET /api/cars/:slug', () => {
      it('should return 401 when Authorization header is missing', async () => {
        const response = await request(app)
          .get('/api/cars/550e8400-e29b-41d4-a716-446655440000');

        expect(response.status).toBe(401);
        expect(response.body.success).toBe(false);
      });

      it('should return 403 when email is not verified', async () => {
        const response = await request(app)
          .get('/api/cars/550e8400-e29b-41d4-a716-446655440000')
          .set('Authorization', 'Bearer unverified-token');

        expect(response.status).toBe(403);
        expect(response.body.success).toBe(false);
      });
    });

    describe('PUT /api/cars/:slug', () => {
      it('should return 401 when Authorization header is missing', async () => {
        const response = await request(app)
          .put('/api/cars/550e8400-e29b-41d4-a716-446655440000')
          .send({ vehicle_color: 'Red' });

        expect(response.status).toBe(401);
        expect(response.body.success).toBe(false);
      });

      it('should return 403 when email is not verified', async () => {
        const response = await request(app)
          .put('/api/cars/550e8400-e29b-41d4-a716-446655440000')
          .set('Authorization', 'Bearer unverified-token')
          .send({ vehicle_color: 'Red' });

        expect(response.status).toBe(403);
        expect(response.body.success).toBe(false);
      });
    });

    describe('DELETE /api/cars/:slug', () => {
      it('should return 401 when Authorization header is missing', async () => {
        const response = await request(app)
          .delete('/api/cars/550e8400-e29b-41d4-a716-446655440000');

        expect(response.status).toBe(401);
        expect(response.body.success).toBe(false);
      });

      it('should return 403 when email is not verified', async () => {
        const response = await request(app)
          .delete('/api/cars/550e8400-e29b-41d4-a716-446655440000')
          .set('Authorization', 'Bearer unverified-token');

        expect(response.status).toBe(403);
        expect(response.body.success).toBe(false);
      });
    });
  });

  describe('POST /api/reg-car', () => {
    it('should register a car successfully with valid data', async () => {
      const carData = createValidCarData();
      const createdCar = createTestCar();

      const mockInsert = {
        select: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: createdCar, error: null }),
        }),
      };
      mockSupabaseUser.from.mockReturnValue({
        insert: jest.fn().mockReturnValue(mockInsert),
      });

      const response = await request(app)
        .post('/api/reg-car')
        .set('Authorization', 'Bearer valid-token')
        .send(carData);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Car registered successfully');
      expect(response.body.data.car).toBeDefined();
    });

    it('should return 422 when required fields are missing', async () => {
      const response = await request(app)
        .post('/api/reg-car')
        .set('Authorization', 'Bearer valid-token')
        .send({});

      expect(response.status).toBe(422);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Validation failed');
      expect(response.body.errors).toBeDefined();
    });

    it('should return 409 when duplicate registration number exists', async () => {
      mockCheckCarDuplicates.mockResolvedValue({
        hasDuplicates: true,
        message: 'A car with registration number ABC123XY already exists',
      });

      const response = await request(app)
        .post('/api/reg-car')
        .set('Authorization', 'Bearer valid-token')
        .send(createValidCarData());

      expect(response.status).toBe(409);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('registration number');
    });

    it('should return 409 when duplicate chassis number exists', async () => {
      mockCheckCarDuplicates.mockResolvedValue({
        hasDuplicates: true,
        message: 'A car with chassis number CH123456 already exists',
      });

      const response = await request(app)
        .post('/api/reg-car')
        .set('Authorization', 'Bearer valid-token')
        .send(createValidCarData());

      expect(response.status).toBe(409);
      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/get-cars', () => {
    it('should return paginated cars successfully', async () => {
      const cars = [createTestCar(), createTestCar({ id: 2, slug: 'another-slug' })];
      
      // Mock for the cars query
      const mockRange = {
        range: jest.fn().mockResolvedValue({ data: cars, error: null }),
      };
      const mockOrder = {
        order: jest.fn().mockReturnValue(mockRange),
      };
      const mockIs1 = {
        is: jest.fn().mockReturnValue(mockOrder),
      };
      const mockSelect1 = {
        select: jest.fn().mockReturnValue(mockIs1),
      };

      // Mock for the count query
      const mockIs2 = {
        is: jest.fn().mockResolvedValue({ count: 2, error: null }),
      };
      const mockSelect2 = {
        select: jest.fn().mockReturnValue(mockIs2),
      };

      mockSupabaseUser.from
        .mockReturnValueOnce(mockSelect1)
        .mockReturnValueOnce(mockSelect2);

      const response = await request(app)
        .get('/api/get-cars')
        .set('Authorization', 'Bearer valid-token')
        .query({ page: 1, limit: 10 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.cars).toBeDefined();
      expect(response.body.data.pagination).toBeDefined();
      expect(response.body.data.pagination.current_page).toBe(1);
      expect(response.body.data.pagination.limit).toBe(10);
    });

    it('should return 400 for invalid page parameter', async () => {
      const response = await request(app)
        .get('/api/get-cars')
        .set('Authorization', 'Bearer valid-token')
        .query({ page: 'invalid' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should return 400 for invalid limit parameter', async () => {
      const response = await request(app)
        .get('/api/get-cars')
        .set('Authorization', 'Bearer valid-token')
        .query({ limit: 'invalid' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should return 400 for page parameter out of range', async () => {
      const response = await request(app)
        .get('/api/get-cars')
        .set('Authorization', 'Bearer valid-token')
        .query({ page: 100001 });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should return 400 for limit parameter out of range', async () => {
      const response = await request(app)
        .get('/api/get-cars')
        .set('Authorization', 'Bearer valid-token')
        .query({ limit: 101 });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should return empty array when user has no cars', async () => {
      // Mock for the cars query
      const mockRange = {
        range: jest.fn().mockResolvedValue({ data: [], error: null }),
      };
      const mockOrder = {
        order: jest.fn().mockReturnValue(mockRange),
      };
      const mockIs1 = {
        is: jest.fn().mockReturnValue(mockOrder),
      };
      const mockSelect1 = {
        select: jest.fn().mockReturnValue(mockIs1),
      };

      // Mock for the count query
      const mockIs2 = {
        is: jest.fn().mockResolvedValue({ count: 0, error: null }),
      };
      const mockSelect2 = {
        select: jest.fn().mockReturnValue(mockIs2),
      };

      mockSupabaseUser.from
        .mockReturnValueOnce(mockSelect1)
        .mockReturnValueOnce(mockSelect2);

      const response = await request(app)
        .get('/api/get-cars')
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(200);
      expect(response.body.data.cars).toEqual([]);
      expect(response.body.data.pagination.total_cars).toBe(0);
    });
  });

  describe('GET /api/cars/:slug', () => {
    it('should return car successfully with valid slug', async () => {
      const car = createTestCar();
      
      const mockSingle = {
        single: jest.fn().mockResolvedValue({ data: car, error: null }),
      };
      const mockIs = {
        is: jest.fn().mockReturnValue(mockSingle),
      };
      const mockEq2 = {
        eq: jest.fn().mockReturnValue(mockIs),
      };
      const mockEq1 = {
        eq: jest.fn().mockReturnValue(mockEq2),
      };
      const mockSelect = {
        select: jest.fn().mockReturnValue(mockEq1),
      };
      mockSupabaseUser.from.mockReturnValue(mockSelect);

      const response = await request(app)
        .get('/api/cars/550e8400-e29b-41d4-a716-446655440000')
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.car).toBeDefined();
      expect(response.body.data.car.slug).toBe('550e8400-e29b-41d4-a716-446655440000');
    });

    it('should return 400 for invalid slug format', async () => {
      const response = await request(app)
        .get('/api/cars/invalid-slug')
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Invalid slug format');
    });

    it('should return 404 when car does not exist', async () => {
      const mockSingle = {
        single: jest.fn().mockResolvedValue({ 
          data: null, 
          error: { code: 'PGRST116' } 
        }),
      };
      const mockIs = {
        is: jest.fn().mockReturnValue(mockSingle),
      };
      const mockEq2 = {
        eq: jest.fn().mockReturnValue(mockIs),
      };
      const mockEq1 = {
        eq: jest.fn().mockReturnValue(mockEq2),
      };
      const mockSelect = {
        select: jest.fn().mockReturnValue(mockEq1),
      };
      mockSupabaseUser.from.mockReturnValue(mockSelect);

      const response = await request(app)
        .get('/api/cars/550e8400-e29b-41d4-a716-446655440000')
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });

    it('should return 404 when accessing another user\'s car', async () => {
      // When user tries to access another user's car, the query filters by user_id
      // So it will return no results (PGRST116 error)
      const mockSingle = {
        single: jest.fn().mockResolvedValue({ 
          data: null, 
          error: { code: 'PGRST116' } 
        }),
      };
      const mockIs = {
        is: jest.fn().mockReturnValue(mockSingle),
      };
      const mockEq2 = {
        eq: jest.fn().mockReturnValue(mockIs),
      };
      const mockEq1 = {
        eq: jest.fn().mockReturnValue(mockEq2),
      };
      const mockSelect = {
        select: jest.fn().mockReturnValue(mockEq1),
      };
      mockSupabaseUser.from.mockReturnValue(mockSelect);

      const response = await request(app)
        .get('/api/cars/550e8400-e29b-41d4-a716-446655440000')
        .set('Authorization', 'Bearer other-user-token');

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });
  });

  describe('PUT /api/cars/:slug', () => {
    it('should update car successfully with valid data', async () => {
      const existingCar = createTestCar();
      const updatedCar = { ...existingCar, vehicle_color: 'Red' };

      // Mock verifyCarExists
      const mockSingle1 = {
        single: jest.fn().mockResolvedValue({ data: existingCar, error: null }),
      };
      const mockIs1 = {
        is: jest.fn().mockReturnValue(mockSingle1),
      };
      const mockEq2_1 = {
        eq: jest.fn().mockReturnValue(mockIs1),
      };
      const mockEq1_1 = {
        eq: jest.fn().mockReturnValue(mockEq2_1),
      };
      const mockSelect1 = {
        select: jest.fn().mockReturnValue(mockEq1_1),
      };

      // Mock update
      const mockSingle2 = {
        single: jest.fn().mockResolvedValue({ data: updatedCar, error: null }),
      };
      const mockSelect2 = {
        select: jest.fn().mockReturnValue(mockSingle2),
      };
      const mockIs2 = {
        is: jest.fn().mockReturnValue(mockSelect2),
      };
      const mockEq2_2 = {
        eq: jest.fn().mockReturnValue(mockIs2),
      };
      const mockEq1_2 = {
        eq: jest.fn().mockReturnValue(mockEq2_2),
      };
      const mockUpdate = {
        update: jest.fn().mockReturnValue(mockEq1_2),
      };

      mockSupabaseUser.from
        .mockReturnValueOnce(mockSelect1)
        .mockReturnValueOnce(mockUpdate);

      const response = await request(app)
        .put('/api/cars/550e8400-e29b-41d4-a716-446655440000')
        .set('Authorization', 'Bearer valid-token')
        .send({ vehicle_color: 'Red' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Car updated successfully');
    });

    it('should return 400 for invalid slug format', async () => {
      const response = await request(app)
        .put('/api/cars/invalid-slug')
        .set('Authorization', 'Bearer valid-token')
        .send({ vehicle_color: 'Red' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Invalid slug format');
    });

    it('should return 404 when car does not exist', async () => {
      const mockSingle = {
        single: jest.fn().mockResolvedValue({ 
          data: null, 
          error: { code: 'PGRST116' } 
        }),
      };
      const mockIs = {
        is: jest.fn().mockReturnValue(mockSingle),
      };
      const mockEq2 = {
        eq: jest.fn().mockReturnValue(mockIs),
      };
      const mockEq1 = {
        eq: jest.fn().mockReturnValue(mockEq2),
      };
      const mockSelect = {
        select: jest.fn().mockReturnValue(mockEq1),
      };
      mockSupabaseUser.from.mockReturnValue(mockSelect);

      const response = await request(app)
        .put('/api/cars/550e8400-e29b-41d4-a716-446655440000')
        .set('Authorization', 'Bearer valid-token')
        .send({ vehicle_color: 'Red' });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });

    it('should return 404 when updating another user\'s car', async () => {
      const mockSingle = {
        single: jest.fn().mockResolvedValue({ 
          data: null, 
          error: { code: 'PGRST116' } 
        }),
      };
      const mockIs = {
        is: jest.fn().mockReturnValue(mockSingle),
      };
      const mockEq2 = {
        eq: jest.fn().mockReturnValue(mockIs),
      };
      const mockEq1 = {
        eq: jest.fn().mockReturnValue(mockEq2),
      };
      const mockSelect = {
        select: jest.fn().mockReturnValue(mockEq1),
      };
      mockSupabaseUser.from.mockReturnValue(mockSelect);

      const response = await request(app)
        .put('/api/cars/550e8400-e29b-41d4-a716-446655440000')
        .set('Authorization', 'Bearer other-user-token')
        .send({ vehicle_color: 'Red' });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });

    it('should return 409 when duplicate identifiers are provided', async () => {
      const existingCar = createTestCar();

      const mockSingle = {
        single: jest.fn().mockResolvedValue({ data: existingCar, error: null }),
      };
      const mockIs = {
        is: jest.fn().mockReturnValue(mockSingle),
      };
      const mockEq2 = {
        eq: jest.fn().mockReturnValue(mockIs),
      };
      const mockEq1 = {
        eq: jest.fn().mockReturnValue(mockEq2),
      };
      const mockSelect = {
        select: jest.fn().mockReturnValue(mockEq1),
      };
      mockSupabaseUser.from.mockReturnValue(mockSelect);

      mockCheckCarDuplicates.mockResolvedValue({
        hasDuplicates: true,
        message: 'A car with registration number ABC123XY already exists',
      });

      const response = await request(app)
        .put('/api/cars/550e8400-e29b-41d4-a716-446655440000')
        .set('Authorization', 'Bearer valid-token')
        .send({ registration_no: 'DUPLICATE123' });

      expect(response.status).toBe(409);
      expect(response.body.success).toBe(false);
    });
  });

  describe('DELETE /api/cars/:slug', () => {
    it('should delete car successfully', async () => {
      const existingCar = createTestCar();

      // Mock verifyCarExists
      const mockSingle1 = {
        single: jest.fn().mockResolvedValue({ data: existingCar, error: null }),
      };
      const mockIs1 = {
        is: jest.fn().mockReturnValue(mockSingle1),
      };
      const mockEq2_1 = {
        eq: jest.fn().mockReturnValue(mockIs1),
      };
      const mockEq1_1 = {
        eq: jest.fn().mockReturnValue(mockEq2_1),
      };
      const mockSelect1 = {
        select: jest.fn().mockReturnValue(mockEq1_1),
      };

      // Mock delete (soft delete via update)
      const mockSelect2 = {
        select: jest.fn().mockResolvedValue({ data: [existingCar], error: null }),
      };
      const mockIs2 = {
        is: jest.fn().mockReturnValue(mockSelect2),
      };
      const mockEq2_2 = {
        eq: jest.fn().mockReturnValue(mockIs2),
      };
      const mockEq1_2 = {
        eq: jest.fn().mockReturnValue(mockEq2_2),
      };
      const mockUpdate = {
        update: jest.fn().mockReturnValue(mockEq1_2),
      };

      mockSupabaseUser.from
        .mockReturnValueOnce(mockSelect1)
        .mockReturnValueOnce(mockUpdate);

      const response = await request(app)
        .delete('/api/cars/550e8400-e29b-41d4-a716-446655440000')
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Car deleted successfully');
    });

    it('should return 400 for invalid slug format', async () => {
      const response = await request(app)
        .delete('/api/cars/invalid-slug')
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Invalid slug format');
    });

    it('should return 404 when car does not exist', async () => {
      const mockSingle = {
        single: jest.fn().mockResolvedValue({ 
          data: null, 
          error: { code: 'PGRST116' } 
        }),
      };
      const mockIs = {
        is: jest.fn().mockReturnValue(mockSingle),
      };
      const mockEq2 = {
        eq: jest.fn().mockReturnValue(mockIs),
      };
      const mockEq1 = {
        eq: jest.fn().mockReturnValue(mockEq2),
      };
      const mockSelect = {
        select: jest.fn().mockReturnValue(mockEq1),
      };
      mockSupabaseUser.from.mockReturnValue(mockSelect);

      const response = await request(app)
        .delete('/api/cars/550e8400-e29b-41d4-a716-446655440000')
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });

    it('should return 404 when deleting another user\'s car', async () => {
      const mockSingle = {
        single: jest.fn().mockResolvedValue({ 
          data: null, 
          error: { code: 'PGRST116' } 
        }),
      };
      const mockIs = {
        is: jest.fn().mockReturnValue(mockSingle),
      };
      const mockEq2 = {
        eq: jest.fn().mockReturnValue(mockIs),
      };
      const mockEq1 = {
        eq: jest.fn().mockReturnValue(mockEq2),
      };
      const mockSelect = {
        select: jest.fn().mockReturnValue(mockEq1),
      };
      mockSupabaseUser.from.mockReturnValue(mockSelect);

      const response = await request(app)
        .delete('/api/cars/550e8400-e29b-41d4-a716-446655440000')
        .set('Authorization', 'Bearer other-user-token');

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });

    it('should return 404 when car is already deleted', async () => {
      const mockSingle = {
        single: jest.fn().mockResolvedValue({ 
          data: null, 
          error: { code: 'PGRST116' } 
        }),
      };
      const mockIs = {
        is: jest.fn().mockReturnValue(mockSingle),
      };
      const mockEq2 = {
        eq: jest.fn().mockReturnValue(mockIs),
      };
      const mockEq1 = {
        eq: jest.fn().mockReturnValue(mockEq2),
      };
      const mockSelect = {
        select: jest.fn().mockReturnValue(mockEq1),
      };
      mockSupabaseUser.from.mockReturnValue(mockSelect);

      const response = await request(app)
        .delete('/api/cars/550e8400-e29b-41d4-a716-446655440000')
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });
  });

  describe('Ownership Enforcement', () => {
    it('should only return cars belonging to authenticated user in GET /api/get-cars', async () => {
      const userCars = [createTestCar({ user_id: 'user-123' })];
      
      // Mock for the cars query
      const mockRange = {
        range: jest.fn().mockResolvedValue({ data: userCars, error: null }),
      };
      const mockOrder = {
        order: jest.fn().mockReturnValue(mockRange),
      };
      const mockIs1 = {
        is: jest.fn().mockReturnValue(mockOrder),
      };
      const mockSelect1 = {
        select: jest.fn().mockReturnValue(mockIs1),
      };

      // Mock for the count query
      const mockIs2 = {
        is: jest.fn().mockResolvedValue({ count: 1, error: null }),
      };
      const mockSelect2 = {
        select: jest.fn().mockReturnValue(mockIs2),
      };

      mockSupabaseUser.from
        .mockReturnValueOnce(mockSelect1)
        .mockReturnValueOnce(mockSelect2);

      const response = await request(app)
        .get('/api/get-cars')
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(200);
      expect(response.body.data.cars).toHaveLength(1);
      expect(response.body.data.cars[0].user_id).toBe('user-123');
    });

    it('should prevent access to another user\'s car via GET /api/cars/:slug', async () => {
      const mockSingle = {
        single: jest.fn().mockResolvedValue({ 
          data: null, 
          error: { code: 'PGRST116' } 
        }),
      };
      const mockIs = {
        is: jest.fn().mockReturnValue(mockSingle),
      };
      const mockEq2 = {
        eq: jest.fn().mockReturnValue(mockIs),
      };
      const mockEq1 = {
        eq: jest.fn().mockReturnValue(mockEq2),
      };
      const mockSelect = {
        select: jest.fn().mockReturnValue(mockEq1),
      };
      mockSupabaseUser.from.mockReturnValue(mockSelect);

      const response = await request(app)
        .get('/api/cars/550e8400-e29b-41d4-a716-446655440000')
        .set('Authorization', 'Bearer other-user-token');

      expect(response.status).toBe(404);
      expect(response.body.message).toContain('not found');
    });

    it('should prevent update of another user\'s car via PUT /api/cars/:slug', async () => {
      const mockSingle = {
        single: jest.fn().mockResolvedValue({ 
          data: null, 
          error: { code: 'PGRST116' } 
        }),
      };
      const mockIs = {
        is: jest.fn().mockReturnValue(mockSingle),
      };
      const mockEq2 = {
        eq: jest.fn().mockReturnValue(mockIs),
      };
      const mockEq1 = {
        eq: jest.fn().mockReturnValue(mockEq2),
      };
      const mockSelect = {
        select: jest.fn().mockReturnValue(mockEq1),
      };
      mockSupabaseUser.from.mockReturnValue(mockSelect);

      const response = await request(app)
        .put('/api/cars/550e8400-e29b-41d4-a716-446655440000')
        .set('Authorization', 'Bearer other-user-token')
        .send({ vehicle_color: 'Red' });

      expect(response.status).toBe(404);
    });

    it('should prevent deletion of another user\'s car via DELETE /api/cars/:slug', async () => {
      const mockSingle = {
        single: jest.fn().mockResolvedValue({ 
          data: null, 
          error: { code: 'PGRST116' } 
        }),
      };
      const mockIs = {
        is: jest.fn().mockReturnValue(mockSingle),
      };
      const mockEq2 = {
        eq: jest.fn().mockReturnValue(mockIs),
      };
      const mockEq1 = {
        eq: jest.fn().mockReturnValue(mockEq2),
      };
      const mockSelect = {
        select: jest.fn().mockReturnValue(mockEq1),
      };
      mockSupabaseUser.from.mockReturnValue(mockSelect);

      const response = await request(app)
        .delete('/api/cars/550e8400-e29b-41d4-a716-446655440000')
        .set('Authorization', 'Bearer other-user-token');

      expect(response.status).toBe(404);
    });
  });
});
