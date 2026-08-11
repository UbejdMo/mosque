import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { mosques } from './mosques.js';
import { households } from './households.js';
import { roleEnum, userStatusEnum } from './enums.js';
import { timestamps } from './columns.js';

/**
 * Login is phone + 6-digit PIN (SPEC §7). No SMS OTP in v1 — it costs money
 * per message before there is a single user, and the village already has a
 * working trust process: the collector hands out claim codes on his rounds.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Null only for `super_admin`, who spans mosques. */
    mosqueId: uuid('mosque_id').references(() => mosques.id, { onDelete: 'restrict' }),
    phone: text('phone').notNull(),
    /** argon2id. Never logged, never returned by any endpoint. */
    pinHash: text('pin_hash').notNull(),
    role: roleEnum('role').notNull(),
    status: userStatusEnum('status').notNull().default('pending'),
    /** Members are pinned to exactly one household and can read nothing else. */
    householdId: uuid('household_id'),

    /**
     * SPEC §8: the only persisted output of ID review. Nothing extracted from
     * the document itself is ever stored — no ID number, no scan text.
     */
    identityVerified: boolean('identity_verified').notNull().default(false),
    reviewedBy: uuid('reviewed_by').references((): AnyPgColumn => users.id, {
      onDelete: 'restrict',
    }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    /**
     * Object key in the private R2 bucket while a registration is pending.
     * Hard-deleted on approve/reject and by the 7-day TTL sweep — this column
     * going back to NULL is what "deleted" means.
     */
    idPhotoKey: text('id_photo_key'),
    idPhotoUploadedAt: timestamp('id_photo_uploaded_at', { withTimezone: true }),

    /** 5 attempts then a 15-minute lockout (SPEC §7). */
    failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    /** Login carries no mosque selector, so phone must be globally unique. */
    unique('users_phone_unique').on(t.phone),
    foreignKey({
      name: 'users_household_fk',
      columns: [t.householdId, t.mosqueId],
      foreignColumns: [households.id, households.mosqueId],
    }).onDelete('restrict'),
    check('users_member_needs_household', sql`${t.role} <> 'member' OR ${t.householdId} IS NOT NULL`),
    check('users_tenant_scoped', sql`${t.role} = 'super_admin' OR ${t.mosqueId} IS NOT NULL`),
    check('users_failed_attempts_non_negative', sql`${t.failedLoginAttempts} >= 0`),
    index('users_mosque_idx').on(t.mosqueId),
    index('users_pending_idx').on(t.mosqueId, t.status),
  ],
);
