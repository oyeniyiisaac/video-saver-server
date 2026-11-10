export function errorHandler(err, req, res, next) {
  console.error('[Error Handler]', err);

  const statusCode = err.statusCode || (res.statusCode && res.statusCode !== 200 ? res.statusCode : 500);
  const message = err.message || 'An unexpected error occurred on the server.';

  res.status(statusCode).json({
    error: message,
  });
}
