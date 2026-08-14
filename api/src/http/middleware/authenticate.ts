import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Role } from '@mosque/shared';
import { scopeFor, type Actor, type TenantScope } from '../../db/tenancy.js';
import {
  SESSION_COOKIE,
  issueSessionToken,
  readSessionToken,
  setSessionCookie,
  shouldRefresh,
} from '../../lib/session.js';
import { loadSessionUser } from '../../services/auth.js';
import { forbidden, unauthenticated } from '../errors.js';

declare module 'express-serve-static-core' {
  interface Request {
    actor?: Actor;
    scope?: TenantScope;
  }
}

/**
 * Turns the session cookie into an `Actor`, and the actor into a
 * `TenantScope`. Every authenticated route gets its mosque filter from here,
 * so no handler ever picks a `mosque_id` out of the request body.
 */
export const authenticate: RequestHandler = async (req, res, next) => {
  const token: unknown = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== 'string' || token.length === 0) {
    next(unauthenticated());
    return;
  }

  const claims = await readSessionToken(token);
  if (!claims) {
    next(unauthenticated('Session expired'));
    return;
  }

  const user = await loadSessionUser(claims.userId);
  if (!user) {
    next(unauthenticated('Session is no longer valid'));
    return;
  }

  req.actor = {
    userId: user.id,
    role: user.role,
    mosqueId: user.mosqueId,
    householdId: user.householdId,
    ip: req.ip,
    userAgent: req.get('user-agent'),
  };
  req.scope = scopeFor(req.actor);

  // 30-day sliding expiry: someone who uses the app regularly is never logged
  // out (SPEC §7).
  if (shouldRefresh(claims)) {
    setSessionCookie(res, await issueSessionToken(user.id));
  }

  next();
};

/** Role checks happen server-side on every route — never trust the client (SPEC §13). */
export function requireRole(...allowed: Role[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.actor) {
      next(unauthenticated());
      return;
    }
    if (!allowed.includes(req.actor.role)) {
      next(forbidden('Your role does not allow this action'));
      return;
    }
    next();
  };
}

/** Narrowing helper so handlers do not repeat the non-null assertion. */
export function requireScope(req: Request): TenantScope {
  if (!req.scope) throw unauthenticated();
  return req.scope;
}
