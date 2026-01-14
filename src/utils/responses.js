/**
 * Standardized API response helpers
 */

export const success = (res, data = null, message = 'Success', statusCode = 200) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data
  });
};

export const created = (res, data = null, message = 'Created successfully') => {
  return success(res, data, message, 201);
};

export const error = (res, message = 'An error occurred', statusCode = 400, errors = null) => {
  const response = {
    success: false,
    message
  };
  
  if (errors) {
    response.errors = errors;
  }
  
  return res.status(statusCode).json(response);
};

export const unauthorized = (res, message = 'Unauthorized') => {
  return error(res, message, 401);
};

export const forbidden = (res, message = 'Forbidden') => {
  return error(res, message, 403);
};

export const notFound = (res, message = 'Not found') => {
  return error(res, message, 404);
};

export const validationError = (res, errors) => {
  return error(res, 'Validation failed', 422, errors);
};

export const serverError = (res, message = 'Internal server error') => {
  return error(res, message, 500);
};

