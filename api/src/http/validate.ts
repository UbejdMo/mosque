import type { Request } from 'express';
import type { ZodType } from 'zod';

/**
 * SPEC §13: every body and query param is validated before it reaches the data
 * layer. Drizzle parameterises queries, so injection is not the risk —
 * out-of-range values landing in the ledger is.
 *
 * These throw ZodError, which the error handler renders as a 400 with the
 * failing paths.
 */
export function parseBody<T>(schema: ZodType<T>, req: Request): T {
  return schema.parse(req.body);
}

export function parseQuery<T>(schema: ZodType<T>, req: Request): T {
  return schema.parse(req.query);
}

export function parseParams<T>(schema: ZodType<T>, req: Request): T {
  return schema.parse(req.params);
}
