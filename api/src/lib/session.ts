import type { Response } from 'express';
import { SignJWT, jwtVerify } from 'jose';
import { z } from 'zod';
import type { Role } from '@mosque/shared';
import { cookieSecure, env } from '../config/env.js';

/**
 * Sessions live in an httpOnly cookie with a 30-day sliding expiry (SPEC §7).
 *
 * The token carries identity only — role and household are re-read from the
 * database on every request. A member who is later rejected, or a collector
 * promoted to imam, must not keep their old permissions until the cookie
 * expires.
 */

export const SESSION_COOKIE = 'mosque_session';

const secret = new TextEncoder().encode(env.JWT_SECRET);
const ISSUER = 'mosque-ledger';

const claimsSchema = z.object({
  sub: z.uuid(),
  iat: z.number(),
  exp: z.number(),
});

export interface SessionClaims {
  userId: string;
  issuedAt: number;
  expiresAt: number;
}

export async function issueSessionToken(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${env.SESSION_TTL_DAYS}d`)
    .sign(secret);
}

/** Returns null for anything unreadable — expired, tampered, wrong issuer. */
export async function readSessionToken(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { issuer: ISSUER });
    const claims = claimsSchema.safeParse(payload);
    if (!claims.success) return null;
    return {
      userId: claims.data.sub,
      issuedAt: claims.data.iat,
      expiresAt: claims.data.exp,
    };
  } catch {
    return null;
  }
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: env.COOKIE_SAMESITE,
    maxAge: env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
    path: '/',
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: env.COOKIE_SAMESITE,
    path: '/',
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  });
}

/**
 * "Sliding" means the cookie is reissued while someone keeps using the app.
 * Refreshing only in the last third of its life avoids re-signing on every
 * request.
 */
export function shouldRefresh(claims: SessionClaims): boolean {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const lifetime = claims.expiresAt - claims.issuedAt;
  return claims.expiresAt - nowSeconds < lifetime / 3;
}

export interface SessionUser {
  id: string;
  role: Role;
  mosqueId: string | null;
  householdId: string | null;
}
