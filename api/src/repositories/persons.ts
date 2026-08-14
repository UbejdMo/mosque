import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { persons, type persons as PersonsTable } from '../db/schema/index.js';
import {
  assertCanWrite,
  householdScopedWhere,
  tenantWhere,
  type DbOrTx,
  type TenantScope,
} from '../db/tenancy.js';
import { writeAudit } from '../lib/audit.js';
import { notFound } from '../http/errors.js';

export type Person = typeof PersonsTable.$inferSelect;

/**
 * Persons — where the money is computed (SPEC §4.1). Everything here goes
 * through the tenancy helpers, so a member can only ever read their own
 * household's people.
 */

export async function listByHousehold(
  scope: TenantScope,
  householdId: string,
): Promise<Person[]> {
  return db
    .select()
    .from(persons)
    .where(
      householdScopedWhere(
        persons,
        scope,
        eq(persons.householdId, householdId),
        isNull(persons.deletedAt),
      ),
    )
    .orderBy(asc(persons.joinedYear), asc(persons.lastName), asc(persons.firstName));
}

export async function findById(scope: TenantScope, id: string): Promise<Person | null> {
  const [row] = await db
    .select()
    .from(persons)
    .where(householdScopedWhere(persons, scope, eq(persons.id, id)))
    .limit(1);
  return row ?? null;
}

export async function getById(scope: TenantScope, id: string): Promise<Person> {
  const person = await findById(scope, id);
  if (!person) throw notFound('Person not found');
  return person;
}

export interface CreateInput {
  householdId: string;
  firstName: string;
  /** Required — the only reliable disambiguator in the village (SPEC §4.1). */
  fatherName: string;
  lastName: string;
  joinedYear: number;
  // `| undefined` is explicit throughout because `exactOptionalPropertyTypes`
  // distinguishes "absent" from "present and undefined", and Zod's `.nullish()`
  // produces the latter.
  leftYear?: number | null | undefined;
  entryReason?: Person['entryReason'] | undefined;
  exitReason?: Person['exitReason'] | undefined;
  isHead?: boolean | undefined;
  livesAbroad?: boolean | undefined;
  predecessorPersonId?: string | null | undefined;
}

export async function create(scope: TenantScope, input: CreateInput): Promise<Person> {
  assertCanWrite(scope);
  return db.transaction(async (tx) => {
    const person = await insert(tx, scope, input);
    await writeAudit(tx, scope, {
      action: 'person.created',
      entityType: 'person',
      entityId: person.id,
      after: person,
    });
    return person;
  });
}

/** Shared by `create` and the life-event services, which supply their own audit action. */
export async function insert(
  tx: DbOrTx,
  scope: TenantScope,
  input: CreateInput,
): Promise<Person> {
  const [row] = await tx
    .insert(persons)
    .values({
      mosqueId: scope.mosqueId,
      householdId: input.householdId,
      firstName: input.firstName,
      fatherName: input.fatherName,
      lastName: input.lastName,
      joinedYear: input.joinedYear,
      leftYear: input.leftYear ?? null,
      entryReason: input.entryReason ?? null,
      exitReason: input.exitReason ?? null,
      isHead: input.isHead ?? false,
      livesAbroad: input.livesAbroad ?? false,
      predecessorPersonId: input.predecessorPersonId ?? null,
    })
    .returning();
  if (!row) throw new Error('Insert returned no person');
  return row;
}

type Updatable = Omit<CreateInput, 'householdId'>;
export type UpdateInput = { [K in keyof Updatable]?: Updatable[K] | undefined };

export async function update(
  scope: TenantScope,
  id: string,
  input: UpdateInput,
): Promise<Person> {
  assertCanWrite(scope);
  return db.transaction(async (tx) => {
    const before = await getForUpdate(tx, scope, id);
    const after = await applyUpdate(tx, scope, id, input);
    await writeAudit(tx, scope, {
      action: 'person.updated',
      entityType: 'person',
      entityId: id,
      before,
      after,
    });
    return after;
  });
}

export async function applyUpdate(
  tx: DbOrTx,
  scope: TenantScope,
  id: string,
  input: UpdateInput,
): Promise<Person> {
  const [row] = await tx
    .update(persons)
    .set(input)
    .where(tenantWhere(persons, scope, eq(persons.id, id)))
    .returning();
  if (!row) throw notFound('Person not found');
  return row;
}

export async function softDelete(scope: TenantScope, id: string): Promise<void> {
  assertCanWrite(scope);
  await db.transaction(async (tx) => {
    const before = await getForUpdate(tx, scope, id);
    await tx
      .update(persons)
      .set({ deletedAt: new Date() })
      .where(tenantWhere(persons, scope, eq(persons.id, id), isNull(persons.deletedAt)));
    await writeAudit(tx, scope, {
      action: 'person.deleted',
      entityType: 'person',
      entityId: id,
      before,
    });
  });
}

/**
 * Repoint a person at a different household.
 *
 * Deliberately not part of `UpdateInput`: moving someone between households
 * rewrites which household their years count towards, so it is only ever done
 * by the split operation, which knows how to preserve history.
 */
export async function movePersonToHousehold(
  tx: DbOrTx,
  scope: TenantScope,
  personId: string,
  householdId: string,
  isHead: boolean,
): Promise<Person> {
  const [row] = await tx
    .update(persons)
    .set({ householdId, isHead })
    .where(tenantWhere(persons, scope, eq(persons.id, personId)))
    .returning();
  if (!row) throw notFound('Person not found');
  return row;
}

export async function getForUpdate(
  tx: DbOrTx,
  scope: TenantScope,
  id: string,
): Promise<Person> {
  const [row] = await tx
    .select()
    .from(persons)
    .where(and(tenantWhere(persons, scope, eq(persons.id, id)), isNull(persons.deletedAt)))
    .limit(1);
  if (!row) throw notFound('Person not found');
  return row;
}
