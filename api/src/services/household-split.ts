import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { households } from '../db/schema/index.js';
import { assertCanWrite, tenantWhere, type TenantScope } from '../db/tenancy.js';
import { writeAudit } from '../lib/audit.js';
import * as personsRepo from '../repositories/persons.js';
import { badRequest, notFound } from '../http/errors.js';

/**
 * Household split (SPEC §5.6) — a son marrying and forming his own household is
 * common and must be a first-class operation, not manual re-entry.
 *
 * The subtle part is history. Obligations are derived from a person's *current*
 * household, so simply repointing `household_id` would retroactively move that
 * person's entire history into the new household — and past obligations must
 * stay with the original one.
 *
 * So the split closes each person's membership of household A at the end of the
 * year before the split, and opens a fresh row in household B from the split
 * year. `predecessor_person_id` links the two, so one human stays followable.
 * Nobody is counted twice in the split year.
 */

export interface SplitInput {
  sourceHouseholdId: string;
  /** Persons moving to the new household. */
  personIds: string[];
  /** Which of the moving persons heads the new household. */
  newHeadPersonId: string;
  splitYear: number;
  neighbourhood?: string | null;
  phone?: string | null;
  notes?: string | null;
}

export interface SplitResult {
  newHouseholdId: string;
  movedPersonIds: string[];
}

export async function splitHousehold(
  scope: TenantScope,
  input: SplitInput,
): Promise<SplitResult> {
  assertCanWrite(scope);

  const currentYear = new Date().getFullYear();
  if (!Number.isInteger(input.splitYear) || input.splitYear > currentYear) {
    throw badRequest('Split year must be a whole year, and cannot be in the future');
  }
  if (input.personIds.length === 0) {
    throw badRequest('Select at least one person to move to the new household');
  }
  if (!input.personIds.includes(input.newHeadPersonId)) {
    throw badRequest('The head of the new household must be one of the people moving');
  }

  return db.transaction(async (tx) => {
    const source = await tx
      .select()
      .from(households)
      .where(tenantWhere(households, scope, eq(households.id, input.sourceHouseholdId)))
      .limit(1);
    if (source.length === 0) throw notFound('Household not found');

    // Load every mover first, so a bad id aborts before anything is written.
    const movers = [];
    for (const personId of input.personIds) {
      const person = await personsRepo.getForUpdate(tx, scope, personId);
      if (person.householdId !== input.sourceHouseholdId) {
        throw badRequest('All selected people must belong to the household being split');
      }
      if (person.leftYear !== null) {
        throw badRequest(
          `${person.firstName} ${person.lastName} has already left the household`,
        );
      }
      movers.push(person);
    }

    const [newHousehold] = await tx
      .insert(households)
      .values({
        mosqueId: scope.mosqueId,
        neighbourhood: input.neighbourhood ?? source[0]?.neighbourhood ?? null,
        phone: input.phone ?? null,
        notes: input.notes ?? null,
      })
      .returning();
    if (!newHousehold) throw new Error('Insert returned no household');

    const movedPersonIds: string[] = [];
    for (const person of movers) {
      /**
       * Someone who joined in the split year or later was never liable under
       * the old household, so there is no history to preserve — move the row
       * itself rather than leaving a zero-length membership behind.
       */
      const hasHistoryToKeep = person.joinedYear < input.splitYear;

      if (hasHistoryToKeep) {
        await personsRepo.applyUpdate(tx, scope, person.id, {
          leftYear: input.splitYear - 1,
          exitReason: 'moved_out',
          isHead: false,
        });
        const created = await personsRepo.insert(tx, scope, {
          householdId: newHousehold.id,
          firstName: person.firstName,
          fatherName: person.fatherName,
          lastName: person.lastName,
          joinedYear: input.splitYear,
          entryReason: 'moved_in',
          livesAbroad: person.livesAbroad,
          isHead: person.id === input.newHeadPersonId,
          predecessorPersonId: person.id,
        });
        movedPersonIds.push(created.id);
      } else {
        const moved = await personsRepo.movePersonToHousehold(
          tx,
          scope,
          person.id,
          newHousehold.id,
          person.id === input.newHeadPersonId,
        );
        movedPersonIds.push(moved.id);
      }
    }

    // One event, not a burst of individual person edits (SPEC §5.6).
    await writeAudit(tx, scope, {
      action: 'household.split',
      entityType: 'household',
      entityId: input.sourceHouseholdId,
      before: { householdId: input.sourceHouseholdId, personIds: input.personIds },
      after: {
        newHouseholdId: newHousehold.id,
        splitYear: input.splitYear,
        movedPersonIds,
      },
    });

    return { newHouseholdId: newHousehold.id, movedPersonIds };
  });
}

/**
 * Dissolve a household (SPEC §5.6). Its outstanding balance is **retained and
 * reportable, not deleted** — this only changes the status, and the obligation
 * view deliberately keeps counting dissolved households.
 *
 * Who inherits that debt is an open question for the imam; until it is
 * answered, nothing here writes it off.
 */
export async function dissolveHousehold(
  scope: TenantScope,
  householdId: string,
  note?: string,
): Promise<void> {
  assertCanWrite(scope);

  await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(households)
      .where(tenantWhere(households, scope, eq(households.id, householdId)))
      .limit(1);
    if (!before) throw notFound('Household not found');

    const [after] = await tx
      .update(households)
      .set({ status: 'dissolved', ...(note ? { notes: note } : {}) })
      .where(tenantWhere(households, scope, eq(households.id, householdId)))
      .returning();

    await writeAudit(tx, scope, {
      action: 'household.dissolved',
      entityType: 'household',
      entityId: householdId,
      before,
      after,
    });
  });
}
