import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { mosques } from './mosques.js';
import { households } from './households.js';
import { users } from './users.js';
import { batchStatusEnum, settlementSourceEnum } from './enums.js';
import { timestamps, yearInRange } from './columns.js';

/**
 * One calendar month of collections handed from collector to imam (SPEC §6).
 * Today this handover is entirely trust-based and undocumented; making it
 * auditable is probably the highest-value feature in the app.
 */
export const collectionBatches = pgTable(
  'collection_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mosqueId: uuid('mosque_id')
      .notNull()
      .references(() => mosques.id, { onDelete: 'restrict' }),
    periodYear: integer('period_year').notNull(),
    periodMonth: integer('period_month').notNull(),
    status: batchStatusEnum('status').notNull().default('open'),

    grossCollectedCents: integer('gross_collected_cents').notNull().default(0),
    /** Snapshotted at close: if BIK moves the percentage, closed batches must not. */
    commissionPercent: integer('commission_percent'),
    /** floor(gross × pct / 100) — the rounding remainder goes to the mosque. */
    commissionCents: integer('commission_cents'),
    netToMosqueCents: integer('net_to_mosque_cents'),

    closedBy: uuid('closed_by').references(() => users.id, { onDelete: 'restrict' }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    confirmedBy: uuid('confirmed_by').references(() => users.id, { onDelete: 'restrict' }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),

    /** Cash counted minus system total. Signed: the count can come up short. */
    discrepancyCents: integer('discrepancy_cents'),
    discrepancyNote: text('discrepancy_note'),
    ...timestamps,
  },
  (t) => [
    unique('batches_mosque_period_unique').on(t.mosqueId, t.periodYear, t.periodMonth),
    unique('batches_id_mosque_unique').on(t.id, t.mosqueId),
    check('batches_period_month_range', sql`${t.periodMonth} BETWEEN 1 AND 12`),
    check('batches_period_year_range', yearInRange(t.periodYear)),
    check('batches_gross_non_negative', sql`${t.grossCollectedCents} >= 0`),
    /**
     * Separation of duties (SPEC §6): the collector must not confirm his own
     * handover. Enforced here so no future route handler can forget it.
     */
    check(
      'batches_separation_of_duties',
      sql`${t.confirmedBy} IS NULL OR ${t.closedBy} IS NULL OR ${t.confirmedBy} <> ${t.closedBy}`,
    ),
    /** A closed batch has its figures frozen; an open one has none of them. */
    check(
      'batches_closed_has_figures',
      sql`${t.status} = 'open' OR (${t.closedBy} IS NOT NULL AND ${t.closedAt} IS NOT NULL
           AND ${t.commissionPercent} IS NOT NULL AND ${t.commissionCents} IS NOT NULL
           AND ${t.netToMosqueCents} IS NOT NULL)`,
    ),
    check(
      'batches_confirmed_has_confirmer',
      sql`${t.status} <> 'confirmed' OR (${t.confirmedBy} IS NOT NULL AND ${t.confirmedAt} IS NOT NULL)`,
    ),
    /** The split must always add back up to the gross. */
    check(
      'batches_split_sums_to_gross',
      sql`${t.commissionCents} IS NULL OR ${t.netToMosqueCents} IS NULL
          OR ${t.commissionCents} + ${t.netToMosqueCents} = ${t.grossCollectedCents}`,
    ),
    index('batches_mosque_status_idx').on(t.mosqueId, t.status),
  ],
);

/**
 * Marks a (household, year) as settled **without recomputation** (SPEC §5.4).
 *
 * You will never have accurate per-person history going back 15 years, and you
 * do not need it: the notebook's ✅ becomes one of these rows, and that year is
 * closed regardless of what the person records say.
 */
export const yearSettlements = pgTable(
  'year_settlements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mosqueId: uuid('mosque_id')
      .notNull()
      .references(() => mosques.id, { onDelete: 'restrict' }),
    householdId: uuid('household_id').notNull(),
    year: integer('year').notNull(),
    source: settlementSourceEnum('source').notNull(),
    note: text('note'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    ...timestamps,
  },
  (t) => [
    unique('year_settlements_household_year_unique').on(t.householdId, t.year),
    foreignKey({
      name: 'year_settlements_household_fk',
      columns: [t.householdId, t.mosqueId],
      foreignColumns: [households.id, households.mosqueId],
    }).onDelete('restrict'),
    check('year_settlements_year_range', yearInRange(t.year)),
    index('year_settlements_mosque_idx').on(t.mosqueId),
  ],
);

/** A cash payment event. The paper receipt remains the legal record. */
export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mosqueId: uuid('mosque_id')
      .notNull()
      .references(() => mosques.id, { onDelete: 'restrict' }),
    householdId: uuid('household_id').notNull(),
    batchId: uuid('batch_id'),
    /**
     * Generated by the client before the payment ever reaches the server, so a
     * replayed offline sync is a no-op rather than a duplicate (SPEC §9).
     * This one constraint is what makes the whole outbox safe.
     */
    clientUuid: uuid('client_uuid').notNull(),
    paidAt: date('paid_at').notNull(),
    totalCents: integer('total_cents').notNull(),
    /** Matches the paper receipt book. Required on every payment. */
    receiptNumber: text('receipt_number').notNull(),
    collectedBy: uuid('collected_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    note: text('note'),
    ...timestamps,
  },
  (t) => [
    unique('payments_client_uuid_unique').on(t.clientUuid),
    unique('payments_id_mosque_unique').on(t.id, t.mosqueId),
    foreignKey({
      name: 'payments_household_fk',
      columns: [t.householdId, t.mosqueId],
      foreignColumns: [households.id, households.mosqueId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'payments_batch_fk',
      columns: [t.batchId, t.mosqueId],
      foreignColumns: [collectionBatches.id, collectionBatches.mosqueId],
    }).onDelete('restrict'),
    check('payments_total_positive', sql`${t.totalCents} > 0`),
    /**
     * Receipt numbers come from the paper book and are typed by hand offline,
     * so duplicates are *flagged on sync*, never blocked (SPEC §9). Hence an
     * index, deliberately not a unique constraint.
     */
    index('payments_receipt_number_idx').on(t.mosqueId, t.receiptNumber),
    index('payments_household_idx').on(t.householdId),
    index('payments_paid_at_idx').on(t.mosqueId, t.paidAt),
    index('payments_batch_idx').on(t.batchId),
  ],
);

/** How one payment is split across years — this is what makes partials work. */
export const paymentAllocations = pgTable(
  'payment_allocations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mosqueId: uuid('mosque_id').notNull(),
    paymentId: uuid('payment_id').notNull(),
    year: integer('year').notNull(),
    amountCents: integer('amount_cents').notNull(),
    ...timestamps,
  },
  (t) => [
    /** One row per year per payment; a second one would double-count. */
    unique('payment_allocations_payment_year_unique').on(t.paymentId, t.year),
    foreignKey({
      name: 'payment_allocations_payment_fk',
      columns: [t.paymentId, t.mosqueId],
      foreignColumns: [payments.id, payments.mosqueId],
    }).onDelete('restrict'),
    check('payment_allocations_amount_positive', sql`${t.amountCents} > 0`),
    check('payment_allocations_year_range', yearInRange(t.year)),
    index('payment_allocations_mosque_year_idx').on(t.mosqueId, t.year),
  ],
);
