/**
 * Domain vocabulary shared by every client.
 *
 * Code is English, UI is Albanian (SPEC §11) — nothing in this file is ever
 * shown to a user directly. These values are persisted, so they are stable:
 * changing a string here is a database migration, not a rename.
 */

export const HOUSEHOLD_STATUSES = ['active', 'dissolved'] as const;
export type HouseholdStatus = (typeof HOUSEHOLD_STATUSES)[number];

/** Why a person joined a household. `birth` is the default for newborns. */
export const ENTRY_REASONS = ['birth', 'married_in', 'moved_in', 'other'] as const;
export type EntryReason = (typeof ENTRY_REASONS)[number];

/**
 * Why a person stopped being liable (SPEC §5.2).
 * Note there is deliberately no `emigrated` — emigration is not an exit and
 * carries no exemption; it sets `livesAbroad` instead.
 */
export const EXIT_REASONS = ['deceased', 'married_out', 'moved_out', 'other'] as const;
export type ExitReason = (typeof EXIT_REASONS)[number];

export const ROLES = ['super_admin', 'imam', 'collector', 'member'] as const;
export type Role = (typeof ROLES)[number];

/**
 * Member self-registrations land as `pending` and wait in the approvals queue
 * (SPEC §7). Staff accounts are created directly as `active` by a super_admin.
 */
export const USER_STATUSES = ['pending', 'active', 'rejected', 'disabled'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const BATCH_STATUSES = ['open', 'closed', 'confirmed'] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

/**
 * How a year came to be settled (SPEC §5.4). A settled year is never
 * recomputed from person data.
 */
export const SETTLEMENT_SOURCES = ['legacy_import', 'manual'] as const;
export type SettlementSource = (typeof SETTLEMENT_SOURCES)[number];

export const LOCALES = ['sq', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'sq';

/** Per-year payment state shown in the household year grid (SPEC §10). */
export const YEAR_STATUSES = ['paid', 'partial', 'unpaid', 'settled'] as const;
export type YearStatus = (typeof YEAR_STATUSES)[number];

/**
 * A person is liable for every year between joinedYear and leftYear, both
 * inclusive — membership is continuous, never paused (SPEC §5.1).
 *
 * The inclusive-on-exit / inclusive-on-entry choice is flagged in the spec as
 * an assumption to confirm with the collector; if it changes, it changes here
 * and in `v_person_liable_year`, nowhere else.
 */
export function isLiable(
  person: { joinedYear: number; leftYear: number | null },
  year: number,
): boolean {
  return person.joinedYear <= year && (person.leftYear === null || person.leftYear >= year);
}
