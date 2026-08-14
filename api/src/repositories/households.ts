import { and, asc, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { HouseholdStatus } from '@mosque/shared';
import { db } from '../db/client.js';
import {
  households,
  persons,
  vHouseholdBalance,
  type households as HouseholdsTable,
} from '../db/schema/index.js';
import {
  assertCanWrite,
  householdWhere,
  tenantWhere,
  type DbOrTx,
  type TenantScope,
} from '../db/tenancy.js';
import { writeAudit } from '../lib/audit.js';
import { notFound } from '../http/errors.js';

/**
 * Households, scoped. Every function here takes a `TenantScope` as its first
 * argument and builds its WHERE clause through the tenancy helpers — that is
 * the whole point of the layer (SPEC §13).
 *
 * Balances come from `v_household_balance` and are never recomputed here
 * (SPEC §5.3).
 */

export type Household = typeof HouseholdsTable.$inferSelect;

export interface HouseholdWithBalance extends Household {
  balanceCents: number;
  yearsUnpaid: number;
  oldestUnpaidYear: number | null;
}

export interface ListOptions {
  /** Matches a person's full name or the neighbourhood, ignoring diacritics. */
  search?: string | undefined;
  neighbourhood?: string | undefined;
  status?: HouseholdStatus | undefined;
  /** For the arrears list: only households owing at least this many years (SPEC §12). */
  minYearsUnpaid?: number | undefined;
  includeDeleted?: boolean | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export async function list(
  scope: TenantScope,
  options: ListOptions = {},
): Promise<HouseholdWithBalance[]> {
  const rows = await db
    .select({
      household: households,
      balanceCents: vHouseholdBalance.balanceCents,
      yearsUnpaid: vHouseholdBalance.yearsUnpaid,
      oldestUnpaidYear: vHouseholdBalance.oldestUnpaidYear,
    })
    .from(households)
    .leftJoin(vHouseholdBalance, eq(vHouseholdBalance.householdId, households.id))
    .where(
      householdWhere(
        households,
        scope,
        options.includeDeleted ? undefined : isNull(households.deletedAt),
        options.neighbourhood ? eq(households.neighbourhood, options.neighbourhood) : undefined,
        options.status ? eq(households.status, options.status) : undefined,
        options.minYearsUnpaid !== undefined
          ? sql`${vHouseholdBalance.yearsUnpaid} >= ${options.minYearsUnpaid}`
          : undefined,
        searchClause(options.search),
      ),
    )
    // Sorted by what is owed: this is the order the collector walks in.
    .orderBy(desc(vHouseholdBalance.balanceCents), asc(households.createdAt))
    .limit(options.limit ?? 200)
    .offset(options.offset ?? 0);

  return rows.map((row) => ({
    ...row.household,
    balanceCents: row.balanceCents ?? 0,
    yearsUnpaid: row.yearsUnpaid ?? 0,
    oldestUnpaidYear: row.oldestUnpaidYear ?? null,
  }));
}

/**
 * Search by a person's name, their father's name, or the neighbourhood
 * (SPEC §10). Diacritic-insensitive in both directions, because the notebook
 * spells names inconsistently and the collector types in a hurry.
 */
function searchClause(term: string | undefined): SQL | undefined {
  const trimmed = term?.trim();
  if (!trimmed) return undefined;

  const pattern = `%${trimmed.toLowerCase()}%`;
  return sql`(
    EXISTS (
      SELECT 1 FROM ${persons} p
      WHERE p.household_id = ${households.id}
        AND p.deleted_at IS NULL
        AND immutable_unaccent(lower(p.first_name || ' ' || p.father_name || ' ' || p.last_name))
            LIKE immutable_unaccent(${pattern})
    )
    OR immutable_unaccent(lower(coalesce(${households.neighbourhood}, '')))
       LIKE immutable_unaccent(${pattern})
  )`;
}

/** Returns null rather than throwing, so callers decide between 404 and 403. */
export async function findById(scope: TenantScope, id: string): Promise<Household | null> {
  const [row] = await db
    .select()
    .from(households)
    .where(householdWhere(households, scope, eq(households.id, id)))
    .limit(1);
  return row ?? null;
}

export async function getById(scope: TenantScope, id: string): Promise<Household> {
  const household = await findById(scope, id);
  if (!household) throw notFound('Household not found');
  return household;
}

export interface CreateInput {
  neighbourhood?: string | null | undefined;
  phone?: string | null | undefined;
  notes?: string | null | undefined;
  needsReview?: boolean | undefined;
}

export async function create(scope: TenantScope, input: CreateInput): Promise<Household> {
  assertCanWrite(scope);

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(households)
      .values({
        mosqueId: scope.mosqueId,
        neighbourhood: input.neighbourhood ?? null,
        phone: input.phone ?? null,
        notes: input.notes ?? null,
        needsReview: input.needsReview ?? false,
      })
      .returning();
    if (!row) throw new Error('Insert returned no household');

    await writeAudit(tx, scope, {
      action: 'household.created',
      entityType: 'household',
      entityId: row.id,
      after: row,
    });
    return row;
  });
}

export type UpdateInput = CreateInput & { status?: HouseholdStatus | undefined };

export async function update(
  scope: TenantScope,
  id: string,
  input: UpdateInput,
): Promise<Household> {
  assertCanWrite(scope);

  return db.transaction(async (tx) => {
    const before = await getForUpdate(tx, scope, id);

    const [row] = await tx
      .update(households)
      .set(input)
      .where(tenantWhere(households, scope, eq(households.id, id)))
      .returning();
    if (!row) throw notFound('Household not found');

    await writeAudit(tx, scope, {
      action: 'household.updated',
      entityType: 'household',
      entityId: id,
      before,
      after: row,
    });
    return row;
  });
}

/**
 * Soft delete only (SPEC §13). Payment history is never deleted, and the
 * foreign keys are ON DELETE RESTRICT, so a hard delete would fail anyway —
 * deliberately.
 */
export async function softDelete(scope: TenantScope, id: string): Promise<void> {
  assertCanWrite(scope);

  await db.transaction(async (tx) => {
    const before = await getForUpdate(tx, scope, id);
    await tx
      .update(households)
      .set({ deletedAt: new Date() })
      .where(tenantWhere(households, scope, eq(households.id, id), isNull(households.deletedAt)));

    await writeAudit(tx, scope, {
      action: 'household.deleted',
      entityType: 'household',
      entityId: id,
      before,
    });
  });
}

async function getForUpdate(tx: DbOrTx, scope: TenantScope, id: string): Promise<Household> {
  const [row] = await tx
    .select()
    .from(households)
    .where(and(tenantWhere(households, scope, eq(households.id, id))))
    .limit(1);
  if (!row) throw notFound('Household not found');
  return row;
}
