import { sql } from 'drizzle-orm';
import { check, integer, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { localeEnum } from './enums.js';
import { timestamps, yearInRange } from './columns.js';

/**
 * The tenant. v1 has exactly one row, but every tenant-scoped table carries
 * `mosque_id` from the first commit — cheap now, expensive to retrofit
 * (SPEC §2).
 */
export const mosques = pgTable(
  'mosques',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    village: text('village').notNull(),
    ledgerStartYear: integer('ledger_start_year').notNull(),
    /** The collector's cut, in whole percent. Snapshotted onto each batch at close. */
    commissionPercent: integer('commission_percent').notNull().default(10),
    currency: text('currency').notNull().default('EUR'),
    defaultLocale: localeEnum('default_locale').notNull().default('sq'),
    ...timestamps,
  },
  (t) => [
    check(
      'mosques_commission_percent_range',
      sql`${t.commissionPercent} >= 0 AND ${t.commissionPercent} <= 100`,
    ),
    check('mosques_ledger_start_year_range', yearInRange(t.ledgerStartYear)),
  ],
);

/**
 * One rate per year, set by BIK (SPEC §4.1). Never a single global setting:
 * historical debts must not change when this year's rate changes.
 */
export const rates = pgTable(
  'rates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mosqueId: uuid('mosque_id')
      .notNull()
      .references(() => mosques.id, { onDelete: 'restrict' }),
    year: integer('year').notNull(),
    amountCents: integer('amount_cents').notNull(),
    ...timestamps,
  },
  (t) => [
    unique('rates_mosque_year_unique').on(t.mosqueId, t.year),
    check('rates_amount_positive', sql`${t.amountCents} > 0`),
    check('rates_year_range', yearInRange(t.year)),
  ],
);
