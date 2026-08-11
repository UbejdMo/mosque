import { sql, type SQL } from 'drizzle-orm';
import { timestamp, type AnyPgColumn } from 'drizzle-orm/pg-core';

/**
 * Every table carries these (SPEC §4.1b). `updated_at` is maintained by a
 * database trigger, not by application code — an UPDATE that forgets to touch
 * it would quietly corrupt the audit trail.
 */
export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

/** Ledger years are plain calendar integers; this keeps typos out of the data. */
export const MIN_LEDGER_YEAR = 1900;
export const MAX_LEDGER_YEAR = 2200;

/**
 * A sanity range for any year column.
 *
 * The bounds go in via `sql.raw` on purpose: a plain `${MIN_LEDGER_YEAR}`
 * becomes a bind parameter, and bind parameters are not legal inside a CHECK
 * constraint — Postgres rejects the DDL outright.
 */
export function yearInRange(column: AnyPgColumn): SQL {
  return sql`${column} BETWEEN ${sql.raw(String(MIN_LEDGER_YEAR))} AND ${sql.raw(String(MAX_LEDGER_YEAR))}`;
}

/** Same, for nullable year columns. */
export function yearInRangeOrNull(column: AnyPgColumn): SQL {
  return sql`${column} IS NULL OR ${yearInRange(column)}`;
}
