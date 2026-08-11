import { and, eq, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { Role } from '@mosque/shared';
import { forbidden } from '../http/errors.js';
import type { Db } from './client.js';

/**
 * Tenancy, in one place (SPEC §13).
 *
 * Every query is scoped by `mosque_id` here rather than in each handler,
 * because one forgotten filter is a cross-tenant leak. Repositories are the
 * only code allowed to touch tables, and they cannot build a WHERE clause
 * without going through these helpers.
 */

export interface Actor {
  userId: string;
  role: Role;
  /** Null only for `super_admin`, who spans mosques. */
  mosqueId: string | null;
  /** Set for members, who are pinned to exactly one household. */
  householdId: string | null;
  ip?: string | undefined;
  userAgent?: string | undefined;
}

export interface TenantScope {
  readonly mosqueId: string;
  readonly actor: Actor;
}

/**
 * Resolve the mosque a request operates on.
 *
 * Ordinary staff and members get their own mosque and cannot ask for another.
 * A super_admin must name the mosque explicitly — there is no "all mosques"
 * query, so a cross-tenant read is always a deliberate, auditable act.
 */
export function scopeFor(actor: Actor, requestedMosqueId?: string): TenantScope {
  if (actor.role === 'super_admin') {
    const mosqueId = requestedMosqueId ?? actor.mosqueId;
    if (!mosqueId) {
      throw forbidden('A super_admin must specify which mosque to operate on');
    }
    return { mosqueId, actor };
  }

  if (!actor.mosqueId) {
    throw forbidden('This account is not attached to a mosque');
  }
  if (requestedMosqueId && requestedMosqueId !== actor.mosqueId) {
    throw forbidden('Not allowed to operate on another mosque');
  }
  return { mosqueId: actor.mosqueId, actor };
}

/** Any table carrying `mosque_id` — which is every tenant-scoped table. */
type TenantTable = { mosqueId: PgColumn };
type HouseholdOwnedTable = TenantTable & { householdId: PgColumn };
/** The `households` table itself, where the household key is `id`. */
type HouseholdTable = TenantTable & { id: PgColumn };

function combine(conditions: (SQL | undefined)[]): SQL {
  const clause = and(...conditions);
  // Unreachable: the tenant predicate is always present.
  if (!clause) throw new Error('Empty tenant predicate');
  return clause;
}

/** The mosque filter, plus whatever else the caller needs. */
export function tenantWhere(
  table: TenantTable,
  scope: TenantScope,
  ...extra: (SQL | undefined)[]
): SQL {
  return combine([eq(table.mosqueId, scope.mosqueId), ...extra]);
}

/**
 * For tables hanging off a household. On top of the mosque filter this pins
 * members to their own household — no member may ever see another member's
 * payment status (SPEC, hard product rule 2), and that holds here rather than
 * depending on every future handler to remember it.
 */
export function householdScopedWhere(
  table: HouseholdOwnedTable,
  scope: TenantScope,
  ...extra: (SQL | undefined)[]
): SQL {
  return combine([
    eq(table.mosqueId, scope.mosqueId),
    memberRestriction(scope, table.householdId),
    ...extra,
  ]);
}

/** Same, for the `households` table, whose household key is `id`. */
export function householdWhere(
  table: HouseholdTable,
  scope: TenantScope,
  ...extra: (SQL | undefined)[]
): SQL {
  return combine([
    eq(table.mosqueId, scope.mosqueId),
    memberRestriction(scope, table.id),
    ...extra,
  ]);
}

function memberRestriction(scope: TenantScope, householdColumn: PgColumn): SQL | undefined {
  if (scope.actor.role !== 'member') return undefined;
  if (!scope.actor.householdId) {
    throw forbidden('This member account is not linked to a household');
  }
  return eq(householdColumn, scope.actor.householdId);
}

/** Roles permitted to write ledger data. Members are read-only, always. */
const WRITE_ROLES: readonly Role[] = ['super_admin', 'imam', 'collector'];

export function assertCanWrite(scope: TenantScope): void {
  if (!WRITE_ROLES.includes(scope.actor.role)) {
    throw forbidden('This account is read-only');
  }
}

/** Rates are the imam's to set — the collector must not move the price (SPEC §4.2). */
export function assertCanSetRates(scope: TenantScope): void {
  if (scope.actor.role !== 'imam' && scope.actor.role !== 'super_admin') {
    throw forbidden('Only the imam can change rates');
  }
}

/** A Drizzle transaction, structurally identical to the db handle. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;
