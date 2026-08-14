import { db } from '../db/client.js';
import { assertCanWrite, type TenantScope } from '../db/tenancy.js';
import { writeAudit } from '../lib/audit.js';
import * as personsRepo from '../repositories/persons.js';
import { badRequest, conflict } from '../http/errors.js';

/**
 * Life events (SPEC §5.2).
 *
 * These are operations, not field edits: "record a death" rather than "set
 * left_year". The collector thinks in events, the audit log reads as events,
 * and the liability rules stay in one place instead of being re-derived at
 * every call site.
 */

export interface NameInput {
  firstName: string;
  fatherName: string;
  lastName: string;
}

function assertPlausibleYear(year: number, label: string): void {
  const currentYear = new Date().getFullYear();
  if (!Number.isInteger(year)) throw badRequest(`${label} must be a whole year`);
  if (year > currentYear) throw badRequest(`${label} cannot be in the future`);
}

/** Birth: a new person, liable from their birth year — inclusive, no pro-rata. */
export async function recordBirth(
  scope: TenantScope,
  input: NameInput & { householdId: string; birthYear: number },
): Promise<personsRepo.Person> {
  assertCanWrite(scope);
  assertPlausibleYear(input.birthYear, 'Birth year');

  return db.transaction(async (tx) => {
    const person = await personsRepo.insert(tx, scope, {
      householdId: input.householdId,
      firstName: input.firstName,
      fatherName: input.fatherName,
      lastName: input.lastName,
      joinedYear: input.birthYear,
      entryReason: 'birth',
    });
    await writeAudit(tx, scope, {
      action: 'person.birth_recorded',
      entityType: 'person',
      entityId: person.id,
      after: person,
    });
    return person;
  });
}

/**
 * A bride joining the household on marriage. Liable from the marriage year,
 * inclusive; the household count goes up by one.
 */
export async function recordMarriedIn(
  scope: TenantScope,
  input: NameInput & { householdId: string; year: number },
): Promise<personsRepo.Person> {
  assertCanWrite(scope);
  assertPlausibleYear(input.year, 'Marriage year');

  return db.transaction(async (tx) => {
    const person = await personsRepo.insert(tx, scope, {
      householdId: input.householdId,
      firstName: input.firstName,
      fatherName: input.fatherName,
      lastName: input.lastName,
      joinedYear: input.year,
      entryReason: 'married_in',
    });
    await writeAudit(tx, scope, {
      action: 'person.married_in',
      entityType: 'person',
      entityId: person.id,
      after: person,
    });
    return person;
  });
}

type ExitEvent = 'death' | 'married_out' | 'moved_out';

const EXIT_REASONS: Record<ExitEvent, personsRepo.Person['exitReason']> = {
  death: 'deceased',
  married_out: 'married_out',
  moved_out: 'moved_out',
};

const EXIT_ACTIONS: Record<ExitEvent, string> = {
  death: 'person.death_recorded',
  married_out: 'person.married_out',
  moved_out: 'person.moved_out',
};

/**
 * Someone stops being liable. The leaving year is **inclusive** — a person who
 * dies in March still owes for that whole year, confirmed with the collector.
 *
 * Death abroad is the same event: the body returns to the village for rites, so
 * the household simply stops paying for them thereafter.
 */
export async function recordExit(
  scope: TenantScope,
  personId: string,
  input: { event: ExitEvent; year: number },
): Promise<personsRepo.Person> {
  assertCanWrite(scope);
  assertPlausibleYear(input.year, 'Year');

  return db.transaction(async (tx) => {
    const before = await personsRepo.getForUpdate(tx, scope, personId);

    if (before.leftYear !== null) {
      // Correcting a mistake must be a deliberate edit, not a second event
      // silently overwriting the first.
      throw conflict(
        `${before.firstName} ${before.lastName} already left in ${before.leftYear}. Edit the person to correct it.`,
      );
    }
    if (input.year < before.joinedYear) {
      throw badRequest(
        `Cannot leave in ${input.year}, before joining in ${before.joinedYear}`,
      );
    }

    const after = await personsRepo.applyUpdate(tx, scope, personId, {
      leftYear: input.year,
      exitReason: EXIT_REASONS[input.event],
      // A departed person cannot remain head of the household.
      ...(before.isHead ? { isHead: false } : {}),
    });

    await writeAudit(tx, scope, {
      action: EXIT_ACTIONS[input.event],
      entityType: 'person',
      entityId: personId,
      before,
      after,
    });
    return after;
  });
}

/**
 * Emigration (SPEC §5.2): **no change to liability at all.**
 *
 * They remain fully liable — they still expect burial in the village. This is
 * the single most commonly misunderstood rule, which is why it is its own
 * operation that touches one boolean and nothing else: there is no code path
 * here that could set a leaving year.
 */
export async function recordEmigration(
  scope: TenantScope,
  personId: string,
  livesAbroad = true,
): Promise<personsRepo.Person> {
  assertCanWrite(scope);

  return db.transaction(async (tx) => {
    const before = await personsRepo.getForUpdate(tx, scope, personId);
    const after = await personsRepo.applyUpdate(tx, scope, personId, { livesAbroad });
    await writeAudit(tx, scope, {
      action: livesAbroad ? 'person.emigrated' : 'person.returned',
      entityType: 'person',
      entityId: personId,
      before,
      after,
    });
    return after;
  });
}

/** Move the *kryefamiljari* marker, keeping the one-head-per-household rule. */
export async function setHeadOfHousehold(
  scope: TenantScope,
  personId: string,
): Promise<personsRepo.Person> {
  assertCanWrite(scope);

  return db.transaction(async (tx) => {
    const person = await personsRepo.getForUpdate(tx, scope, personId);
    if (person.leftYear !== null) {
      throw badRequest('Someone who has left the household cannot be its head');
    }

    const current = await personsRepo.listByHousehold(scope, person.householdId);
    for (const existing of current) {
      if (existing.isHead && existing.id !== personId) {
        await personsRepo.applyUpdate(tx, scope, existing.id, { isHead: false });
      }
    }

    const after = await personsRepo.applyUpdate(tx, scope, personId, { isHead: true });
    await writeAudit(tx, scope, {
      action: 'person.made_head',
      entityType: 'person',
      entityId: personId,
      before: person,
      after,
    });
    return after;
  });
}
