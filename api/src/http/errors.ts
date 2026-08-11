/**
 * Every error the API returns on purpose.
 *
 * Wire shape is always `{ error: { code, message, details? } }`. The `code` is
 * a stable machine-readable string — clients (including the future native one)
 * branch on it; `message` is for developers, never shown to a villager
 * untranslated.
 */
export type ErrorCode =
  | 'bad_request'
  | 'validation_failed'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'internal_error';

export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details: unknown;

  constructor(status: number, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, 'bad_request', message, details);

export const unauthenticated = (message = 'Authentication required') =>
  new AppError(401, 'unauthenticated', message);

export const forbidden = (message = 'Not allowed') => new AppError(403, 'forbidden', message);

export const notFound = (message = 'Not found') => new AppError(404, 'not_found', message);

export const conflict = (message: string, details?: unknown) =>
  new AppError(409, 'conflict', message, details);
