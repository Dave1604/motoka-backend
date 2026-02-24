/**
 * Payment Response Utility
 * 
 * Shared response helper for payment controllers.
 * Response shape uses 'status' (boolean) instead of 'success' for compatibility
 * with the existing frontend contract. Do not change the field name.
 */
export const paymentResponse = {
  success: (res, data = null, message = 'Success', statusCode = 200) => {
    return res.status(statusCode).json({ status: true, message, data });
  },
  created: (res, data = null, message = 'Created successfully') => {
    return res.status(201).json({ status: true, message, data });
  },
  error: (res, message = 'An error occurred', statusCode = 400, errors = null) => {
    const errorResponse = { status: false, message };
    if (errors) errorResponse.errors = errors;
    return res.status(statusCode).json(errorResponse);
  },
  notFound: (res, message = 'Not found') => paymentResponse.error(res, message, 404),
  forbidden: (res, message = 'Forbidden') => paymentResponse.error(res, message, 403),
  serverError: (res, message = 'Internal server error') => paymentResponse.error(res, message, 500)
};
