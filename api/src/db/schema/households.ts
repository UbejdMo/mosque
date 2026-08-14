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
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { mosques } from './mosques.js';
import { entryReasonEnum, exitReasonEnum, householdStatusEnum } from './enums.js';
import { timestamps, yearInRange, yearInRangeOrNull } from './columns.js';

/** The billing unit — *familja / shtëpia*. */
export const households = pgTable(
  'households',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mosqueId: uuid('mosque_id')
      .notNull()
      .references(() => mosques.id, { onDelete: 'restrict' }),
    status: householdStatusEnum('status').notNull().default('active'),
    /** *Lagja* — the neighbourhood the collector walks. */
    neighbourhood: text('neighbourhood'),
    phone: text('phone'),
    notes: text('notes'),
    /** 8 chars, no 0/O/1/I/l — handed out on a slip during the rounds (SPEC §7). */
    claimCode: text('claim_code'),
    claimCodeUsedAt: timestamp('claim_code_used_at', { withTimezone: true }),
    /**
     * SPEC §15: the notebook will contain contradictions. Flag them rather
     * than forcing the transcriber to decide at entry time.
     */
    needsReview: boolean('needs_review').notNull().default(false),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    /**
     * Lets children reference (household_id, mosque_id) together, which makes
     * a row belonging to mosque A but pointing at mosque B's household
     * impossible to write — rather than merely unlikely.
     */
    unique('households_id_mosque_unique').on(t.id, t.mosqueId),
    uniqueIndex('households_claim_code_unique')
      .on(t.mosqueId, t.claimCode)
      .where(sql`claim_code IS NOT NULL`),
    index('households_mosque_idx').on(t.mosqueId),
    index('households_neighbourhood_idx').on(t.mosqueId, t.neighbourhood),
  ],
);

/**
 * A member of a household — this is where the money is computed (SPEC §4.1).
 *
 * `father_name` is required, not optional: in a village with five men named
 * Ismet Krasniqi it is the only reliable disambiguator, and the paper receipt
 * already uses it.
 */
export const persons = pgTable(
  'persons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mosqueId: uuid('mosque_id')
      .notNull()
      .references(() => mosques.id, { onDelete: 'restrict' }),
    householdId: uuid('household_id').notNull(),
    firstName: text('first_name').notNull(),
    fatherName: text('father_name').notNull(),
    lastName: text('last_name').notNull(),
    joinedYear: integer('joined_year').notNull(),
    leftYear: integer('left_year'),
    entryReason: entryReasonEnum('entry_reason'),
    exitReason: exitReasonEnum('exit_reason'),
    isHead: boolean('is_head').notNull().default(false),
    /** Emigration is not an exit and carries no exemption (SPEC §5.2). */
    livesAbroad: boolean('lives_abroad').notNull().default(false),
    /**
     * When a household splits (SPEC §5.6), the person's membership of the old
     * household is closed and a new row opens in the new one — otherwise the
     * obligation view would retroactively move their whole history across, and
     * past obligations must stay with the original household.
     *
     * This points at the closed row, so one human stays followable across the
     * split even though they occupy two rows.
     */
    predecessorPersonId: uuid('predecessor_person_id').references(
      (): AnyPgColumn => persons.id,
      { onDelete: 'restrict' },
    ),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: 'persons_household_fk',
      columns: [t.householdId, t.mosqueId],
      foreignColumns: [households.id, households.mosqueId],
    }).onDelete('restrict'),
    check('persons_left_year_after_joined', sql`${t.leftYear} IS NULL OR ${t.leftYear} >= ${t.joinedYear}`),
    /** An exit reason without a leaving year is a half-recorded life event. */
    check('persons_exit_reason_needs_left_year', sql`${t.leftYear} IS NOT NULL OR ${t.exitReason} IS NULL`),
    check('persons_joined_year_range', yearInRange(t.joinedYear)),
    check('persons_left_year_range', yearInRangeOrNull(t.leftYear)),
    /** At most one *kryefamiljari* per household among the living records. */
    uniqueIndex('persons_one_head_per_household')
      .on(t.householdId)
      .where(sql`is_head AND deleted_at IS NULL`),
    index('persons_household_idx').on(t.householdId),
    index('persons_mosque_idx').on(t.mosqueId),
  ],
);
