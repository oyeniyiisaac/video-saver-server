import rateLimit from 'express-rate-limit';

export const infoLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many info requests from this IP. Please try again after a minute.',
  },
  statusCode: 429,
});

export const downloadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many download requests from this IP. Please try again after a minute.',
  },
  statusCode: 429,
});
