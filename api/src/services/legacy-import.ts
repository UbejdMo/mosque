import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { households, mosques, persons, yearSettlements } from '../db/schema/index.js';
import { assertCanWrite, tenantWhere, type TenantScope } from '../db/tenancy.js';
import { writeAudit } from '../lib/audit.js';
import { badRequest } from '../http/errors.js';
import type { EntryReason, ExitReason } from '@mosque/shared';

/**
 * Importing the paper notebook (SPEC §15, §5.4).
 *
 * You will never have accurate per-person history going back fifteen years, and
 * you do not need it. Every year the notebook marks ✅ becomes a
 * `year_settlement` with `source = 'legacy_import'`, and a settled year is
 * never recomputed. Only the unticked years are worked out from person data.
 *
 * That is what makes this migration tractable: the transcriber copies ticks,
 * not reconstructed family histories.
 */

export interface ImportPersonInput {
  firstName: string;
  fatherName: string;
  lastName: string;
  joinedYear: number;
  leftYear?: number | null | undefined;
  entryReason?: EntryReason | null | undefined;
  exitReason?: ExitReason | null | undefined;
  isHead?: boolean | undefined;
  livesAbroad?: boolean | undefined;
}

export interface ImportHouseholdInput {
  neighbourhood?: string | null | undefined;
  phone?: string | null | undefined;
  notes?: string | null | undefined;
  /**
   * The notebook will contain contradictions. Flagging one is always better
   * than forcing the transcriber to resolve it at entry time (SPEC §15).
   */
  needsReview?: boolean | undefined;
  persons: ImportPersonInput[];
  /** Years the notebook marks as paid. */
  settledYears: number[];
}

export interface ImportResult {
  householdIds: string[];
  personCount: number;
  settlementCount: number;
}

/**
 * Imports a batch of households in **one transaction**: 500 rows either land
 * together or not at all. A partial import is far worse than a failed one —
 * nobody can tell by eye which half of the notebook made it in.
 */
export async function importHouseholds(
  scope: TenantScope,
  inputs: ImportHouseholdInput[],
): Promise<ImportResult> {
  assertCanWrite(scope);

  if (inputs.length === 0) throw badRequest('Nothing to import');

  const [mosque] = await db
    .select({ ledgerStartYear: mosques.ledgerStartYear })
    .from(mosques)
    .where(eq(mosques.id, scope.mosqueId))
    .limit(1);
  if (!mosque) throw badRequest('Mosque not found');

  const currentYear = new Date().getFullYear();
  inputs.forEach((input, index) =>
    validate(input, index, mosque.ledgerStartYear, currentYear),
  );

  return db.transaction(async (tx) => {
    const householdIds: string[] = [];
    let personCount = 0;
    let settlementCount = 0;

    for (const input of inputs) {
      const [household] = await tx
        .insert(households)
        .values({
          mosqueId: scope.mosqueId,
          neighbourhood: input.neighbourhood ?? null,
          phone: input.phone ?? null,
          notes: input.notes ?? null,
          needsReview: input.needsReview ?? false,
        })
        .returning({ id: households.id });
      if (!household) throw new Error('Insert returned no household');

      await tx.insert(persons).values(
        input.persons.map((person) => ({
          mosqueId: scope.mosqueId,
          householdId: household.id,
          firstName: person.firstName.trim(),
          fatherName: person.fatherName.trim(),
          lastName: person.lastName.trim(),
          joinedYear: person.joinedYear,
          leftYear: person.leftYear ?? null,
          entryReason: person.entryReason ?? null,
          exitReason: person.exitReason ?? null,
          isHead: person.isHead ?? false,
          livesAbroad: person.livesAbroad ?? false,
        })),
      );
      personCount += input.persons.length;

      if (input.settledYears.length > 0) {
        await tx.insert(yearSettlements).values(
          input.settledYears.map((year) => ({
            mosqueId: scope.mosqueId,
            householdId: household.id,
            year,
            source: 'legacy_import' as const,
            createdBy: scope.actor.userId,
          })),
        );
        settlementCount += input.settledYears.length;
      }

      await writeAudit(tx, scope, {
        action: 'household.imported',
        entityType: 'household',
        entityId: household.id,
        after: {
          persons: input.persons.length,
          settledYears: input.settledYears,
          needsReview: input.needsReview ?? false,
        },
      });

      householdIds.push(household.id);
    }

    return { householdIds, personCount, settlementCount };
  });
}

function validate(
  input: ImportHouseholdInput,
  index: number,
  ledgerStartYear: number,
  currentYear: number,
): void {
  const where = `Row ${index + 1}`;

  if (input.persons.length === 0) {
    throw badRequest(`${where}: a household needs at least one person`);
  }

  // The notebook keeps one line per head of household, so every imported row
  // has exactly one — if it does not, the transcription is ambiguous.
  const heads = input.persons.filter((person) => person.isHead);
  if (heads.length !== 1) {
    throw badRequest(
      `${where}: expected exactly one head of household, found ${heads.length}`,
    );
  }

  for (const person of input.persons) {
    const name = `${person.firstName} ${person.lastName}`.trim();
    if (!person.firstName.trim() || !person.fatherName.trim() || !person.lastName.trim()) {
      throw badRequest(`${where}: every person needs a first name, father's name and surname`);
    }
    if (person.joinedYear > currentYear) {
      throw badRequest(`${where}: ${name} joined in ${person.joinedYear}, which is in the future`);
    }
    if (person.leftYear != null && person.leftYear < person.joinedYear) {
      throw badRequest(`${where}: ${name} left before joining`);
    }
  }

  const seen = new Set<number>();
  for (const year of input.settledYears) {
    if (!Number.isInteger(year)) throw badRequest(`${where}: ${year} is not a year`);
    if (seen.has(year)) throw badRequest(`${where}: year ${year} is ticked twice`);
    seen.add(year);
    if (year < ledgerStartYear || year > currentYear) {
      throw badRequest(
        `${where}: year ${year} is outside the ledger (${ledgerStartYear}–${currentYear})`,
      );
    }
  }
}

/** Neighbourhoods already in use, to keep the entry screen's spelling consistent. */
export async function listNeighbourhoods(scope: TenantScope): Promise<string[]> {
  const rows = await db
    .selectDistinct({ neighbourhood: households.neighbourhood })
    .from(households)
    .where(tenantWhere(households, scope));
  return rows
    .map((row) => row.neighbourhood)
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => a.localeCompare(b, 'sq'));
}
