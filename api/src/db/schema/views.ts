import { boolean, integer, pgView, text, uuid } from 'drizzle-orm/pg-core';

/**
 * These views are owned by the SQL migration (`0002_obligation_views.sql`), not
 * by drizzle-kit — `.existing()` tells it not to manage them. Declared here so
 * queries against them are typed.
 *
 * Money columns come back as `bigint`, which the pg driver hands over as a
 * string to avoid precision loss. `client.ts` installs a parser that turns
 * INT8 into a JS number; cents stay far inside Number.MAX_SAFE_INTEGER.
 */
export const vHouseholdYearObligation = pgView('v_household_year_obligation', {
  mosqueId: uuid('mosque_id').notNull(),
  householdId: uuid('household_id').notNull(),
  year: integer('year').notNull(),
  liablePersonCount: integer('liable_person_count').notNull(),
  rateCents: integer('rate_cents'),
  rateMissing: boolean('rate_missing').notNull(),
  isSettled: boolean('is_settled').notNull(),
  settlementSource: text('settlement_source'),
  obligationCents: integer('obligation_cents').notNull(),
  allocatedCents: integer('allocated_cents').notNull(),
  balanceCents: integer('balance_cents').notNull(),
  /** One of YEAR_STATUSES: settled | unpaid | partial | paid. */
  status: text('status').notNull(),
}).existing();

export const vHouseholdBalance = pgView('v_household_balance', {
  mosqueId: uuid('mosque_id').notNull(),
  householdId: uuid('household_id').notNull(),
  totalObligationCents: integer('total_obligation_cents').notNull(),
  totalAllocatedCents: integer('total_allocated_cents').notNull(),
  balanceCents: integer('balance_cents').notNull(),
  yearsUnpaid: integer('years_unpaid').notNull(),
  oldestUnpaidYear: integer('oldest_unpaid_year'),
  hasMissingRate: boolean('has_missing_rate'),
}).existing();
