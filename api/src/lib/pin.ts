import { hash, verify } from '@node-rs/argon2';
import { badRequest } from '../http/errors.js';

/**
 * PIN handling (SPEC §7). Six digits, argon2id.
 *
 * A 6-digit PIN has a million combinations, which is only safe because online
 * guessing is capped at five attempts per account. Never relax the lockout
 * without revisiting this.
 */

const PIN_PATTERN = /^\d{6}$/;

/**
 * Deliberately mild: this app is used by villagers who will write the PIN on a
 * slip of paper if the rules get fussy. Only all-identical digits are refused
 * — the real protection is the lockout, not PIN entropy rules.
 */
export function assertPinAcceptable(pin: string): void {
  if (!PIN_PATTERN.test(pin)) {
    throw badRequest('PIN must be exactly 6 digits');
  }
  if (/^(\d)\1{5}$/.test(pin)) {
    throw badRequest('PIN must not be the same digit six times');
  }
}

/** OWASP-recommended argon2id parameters: 19 MiB, 2 passes, 1 lane. */
const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPin(pin: string): Promise<string> {
  assertPinAcceptable(pin);
  return hash(pin, ARGON2_OPTIONS);
}

export async function verifyPin(pinHash: string, pin: string): Promise<boolean> {
  try {
    return await verify(pinHash, pin, ARGON2_OPTIONS);
  } catch {
    // A malformed stored hash must read as "wrong PIN", never as a crash that
    // tells an attacker something about the account.
    return false;
  }
}

/**
 * Burn the same work when the phone number is unknown, so response time does
 * not reveal which numbers are registered.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZS1maXhlZC1zYWx0LXY$IJTFRTLmpvSDsmoWs0AVzP6JZDDe/2E5dpDNM5f3xGA';

export async function burnVerifyTime(pin: string): Promise<void> {
  await verifyPin(DUMMY_HASH, pin);
}
