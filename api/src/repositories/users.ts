import { eq, sql } from 'drizzle-orm';
import type { Role } from '@mosque/shared';
import { db } from '../db/client.js';
import { users, type users as UsersTable } from '../db/schema/index.js';
import { hashPin } from '../lib/pin.js';
import { writeAudit } from '../lib/audit.js';
import { assertCanWrite, tenantWhere, type TenantScope } from '../db/tenancy.js';
import { conflict, forbidden, notFound } from '../http/errors.js';

export type User = typeof UsersTable.$inferSelect;

/**
 * The one query in the system that is deliberately not tenant-scoped: at login
 * there is no session yet, so there is no mosque to scope to. Phone numbers are
 * globally unique precisely so this lookup is unambiguous.
 *
 * Everything downstream of authentication goes through `TenantScope`.
 */
export async function findByPhoneForLogin(phone: string): Promise<User | null> {
  const [row] = await db.select().from(users).where(eq(users.phone, phone)).limit(1);
  return row ?? null;
}

export async function findById(id: string): Promise<User | null> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row ?? null;
}

/** Counts a failed attempt and locks the account once the limit is reached. */
export async function recordFailedAttempt(
  userId: string,
  maxAttempts: number,
  lockoutMinutes: number,
): Promise<void> {
  await db
    .update(users)
    .set({
      failedLoginAttempts: sql`${users.failedLoginAttempts} + 1`,
      lockedUntil: sql`CASE WHEN ${users.failedLoginAttempts} + 1 >= ${maxAttempts}
                            THEN now() + ${`${lockoutMinutes} minutes`}::interval
                            ELSE ${users.lockedUntil} END`,
    })
    .where(eq(users.id, userId));
}

/** A good login clears the counter and the lock together. */
export async function recordSuccessfulLogin(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() })
    .where(eq(users.id, userId));
}

export interface CreateStaffInput {
  phone: string;
  pin: string;
  role: Extract<Role, 'imam' | 'collector'>;
}

/**
 * Staff accounts are created by hand, never self-signup (SPEC §7). The first
 * super_admin comes from the seed script, not from here.
 */
export async function createStaff(scope: TenantScope, input: CreateStaffInput): Promise<User> {
  assertCanWrite(scope);
  if (scope.actor.role !== 'super_admin' && scope.actor.role !== 'imam') {
    throw forbidden('Only an imam or super_admin can create staff accounts');
  }

  const existing = await findByPhoneForLogin(input.phone);
  if (existing) throw conflict('That phone number is already registered');

  const pinHash = await hashPin(input.pin);

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(users)
      .values({
        mosqueId: scope.mosqueId,
        phone: input.phone,
        pinHash,
        role: input.role,
        status: 'active',
      })
      .returning();
    if (!row) throw new Error('Insert returned no user');

    await writeAudit(tx, scope, {
      action: 'user.created',
      entityType: 'user',
      entityId: row.id,
      // Never the PIN hash, not even in the audit trail.
      after: { phone: row.phone, role: row.role, status: row.status },
    });
    return row;
  });
}

export async function getInMosque(scope: TenantScope, userId: string): Promise<User> {
  const [row] = await db
    .select()
    .from(users)
    .where(tenantWhere(users, scope, eq(users.id, userId)))
    .limit(1);
  if (!row) throw notFound('User not found');
  return row;
}
