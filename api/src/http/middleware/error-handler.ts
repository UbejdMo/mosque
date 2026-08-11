import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../errors.js';
import { isProduction } from '../../config/env.js';
import { logger } from '../../lib/logger.js';

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: { code: 'not_found', message: `No route for ${req.method} ${req.path}` },
  });
};

/**
 * The single place an error becomes a response body. Express 5 forwards
 * rejected async handlers here automatically, so route code never needs
 * try/catch just to report a failure.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'validation_failed',
        message: 'Request failed validation',
        details: err.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details === undefined ? {} : { details: err.details }),
      },
    });
    return;
  }

  // Anything reaching here is a bug. Log it in full, tell the client nothing:
  // an unexpected error's message can carry a query fragment or a row value.
  logger.error({ err }, 'Unhandled error');
  res.status(500).json({
    error: {
      code: 'internal_error',
      message: isProduction ? 'Internal server error' : String(err),
    },
  });
};
