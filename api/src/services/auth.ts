import { AppError, unauthenticated } from '../http/errors.js';
import { burnVerifyTime, verifyPin } from '../lib/pin.js';
import { issueSessionToken, type SessionUser } from '../lib/session.js';
import * as usersRepo from '../repositories/users.js';

/**
 * Login (SPEC §7): phone + 6-digit PIN, five attempts, then a 15-minute
 * lockout.
 */
export const MAX_LOGIN_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;

export interface LoginResult {
  token: string;
  user: SessionUser;
}

export async function login(phone: string, pin: string): Promise<LoginResult> {
  const user = await usersRepo.findByPhoneForLogin(phone);

  if (!user) {
    // Spend the same time hashing as a real verification would, so response
    // time cannot be used to enumerate which numbers are registered.
    await burnVerifyTime(pin);
    throw unauthenticated('Invalid phone number or PIN');
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutesLeft = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
    /**
     * This does tell an attacker the account exists. Accepted deliberately: in
     * a village of 500 households the phone numbers are common knowledge, and
     * a locked-out collector standing in a courtyard needs to know he must
     * wait rather than that he mistyped.
     */
    throw new AppError(429, 'rate_limited', `Too many attempts. Try again in ${minutesLeft} minutes`);
  }

  const pinMatches = await verifyPin(user.pinHash, pin);
  if (!pinMatches) {
    await usersRepo.recordFailedAttempt(user.id, MAX_LOGIN_ATTEMPTS, LOCKOUT_MINUTES);
    throw unauthenticated('Invalid phone number or PIN');
  }

  // Correct PIN, but the account is not usable yet — say which, because the
  // member cannot fix it and needs to know to go and ask the collector.
  if (user.status === 'pending') {
    throw new AppError(403, 'forbidden', 'This registration is still waiting for approval');
  }
  if (user.status !== 'active') {
    throw new AppError(403, 'forbidden', 'This account is not active');
  }

  await usersRepo.recordSuccessfulLogin(user.id);

  return {
    token: await issueSessionToken(user.id),
    user: {
      id: user.id,
      role: user.role,
      mosqueId: user.mosqueId,
      householdId: user.householdId,
    },
  };
}

/**
 * Resolve the session's user on every request. Role and household are read
 * fresh rather than trusted from the token — a revoked account must stop
 * working immediately, not when its cookie expires.
 */
export async function loadSessionUser(userId: string): Promise<SessionUser | null> {
  const user = await usersRepo.findById(userId);
  if (!user || user.status !== 'active') return null;
  return {
    id: user.id,
    role: user.role,
    mosqueId: user.mosqueId,
    householdId: user.householdId,
  };
}
