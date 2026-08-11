import { pgEnum } from 'drizzle-orm/pg-core';
import {
  BATCH_STATUSES,
  ENTRY_REASONS,
  EXIT_REASONS,
  HOUSEHOLD_STATUSES,
  LOCALES,
  ROLES,
  SETTLEMENT_SOURCES,
  USER_STATUSES,
} from '@mosque/shared';

/**
 * Postgres enums, sourced from the shared vocabulary so the database, the API
 * and every client cannot drift apart. Adding a value here is a migration.
 */
export const householdStatusEnum = pgEnum('household_status', HOUSEHOLD_STATUSES);
export const entryReasonEnum = pgEnum('entry_reason', ENTRY_REASONS);
export const exitReasonEnum = pgEnum('exit_reason', EXIT_REASONS);
export const roleEnum = pgEnum('user_role', ROLES);
export const userStatusEnum = pgEnum('user_status', USER_STATUSES);
export const batchStatusEnum = pgEnum('batch_status', BATCH_STATUSES);
export const settlementSourceEnum = pgEnum('settlement_source', SETTLEMENT_SOURCES);
export const localeEnum = pgEnum('locale', LOCALES);
