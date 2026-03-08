/**
 * middleware/auth.js – API Key authentication
 * Expects: Authorization: Bearer <AGI_API_KEY>
 */

export function requireApiKey(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token || token !== process.env.AGI_API_KEY) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Provide a valid API key via Authorization: Bearer <key>',
    });
  }
  next();
}

/**
 * Validate a request body against required fields.
 */
export function requireFields(fields) {
  return (req, res, next) => {
    const missing = fields.filter(f => req.body[f] === undefined || req.body[f] === null || req.body[f] === '');
    if (missing.length > 0) {
      return res.status(400).json({
        error: 'BadRequest',
        message: `Missing required fields: ${missing.join(', ')}`,
      });
    }
    next();
  };
}

/**
 * Global error handler for the Express app.
 */
export function errorHandler(err, req, res, _next) {
  console.error('[AGI Wallet Error]', err);
  const status = err.status || 500;
  res.status(status).json({
    error: err.name || 'InternalServerError',
    message: err.message || 'An unexpected error occurred',
  });
}
