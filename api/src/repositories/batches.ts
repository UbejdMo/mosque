import { and, eq, sql } from 'drizzle-orm';
import { collectionBatches, type collectionBatches as BatchesTable } from '../db/schema/index.js';
import { tenantWhere, type DbOrTx, type TenantScope } from '../db/tenancy.js';
import { conflict } from '../http/errors.js';

export type CollectionBatch = typeof BatchesTable.$inferSelect;

/**
 * Collection batches (SPEC §6). Close and confirm belong to the collector
 * workflow in Phase 2; what the ledger needs now is step 1 of the flow —
 * every payment auto-attaches to the open batch for its month.
 */

/**
 * The open batch for a given month, created on first use.
 *
 * Deliberately not "the mosque's one open batch": a collector who has not yet
 * closed January while February is under way needs both open at once.
 */
export async function findOrCreateOpenBatch(
  tx: DbOrTx,
  scope: TenantScope,
  periodYear: number,
  periodMonth: number,
): Promise<CollectionBatch> {
  const [existing] = await tx
    .select()
    .from(collectionBatches)
    .where(
      tenantWhere(
        collectionBatches,
        scope,
        eq(collectionBatches.periodYear, periodYear),
        eq(collectionBatches.periodMonth, periodMonth),
      ),
    )
    .limit(1);

  if (existing) {
    if (existing.status !== 'open') {
      /**
       * A closed batch is read-only (SPEC §6), so a payment cannot be dropped
       * into it — the figures the imam already counted would move underneath
       * him. The imam can reopen the month, which is itself audited.
       *
       * This is reachable from the offline outbox: payments taken in a month
       * that was closed before they synced. The collector app has to surface
       * that rather than swallow it — the money is already in his pocket.
       */
      throw conflict(
        `The batch for ${periodMonth}/${periodYear} is ${existing.status}. The imam must reopen it before payments can be added.`,
        { batchId: existing.id, status: existing.status, periodYear, periodMonth },
      );
    }
    return existing;
  }

  const [created] = await tx
    .insert(collectionBatches)
    .values({ mosqueId: scope.mosqueId, periodYear, periodMonth, status: 'open' })
    .onConflictDoNothing({
      target: [
        collectionBatches.mosqueId,
        collectionBatches.periodYear,
        collectionBatches.periodMonth,
      ],
    })
    .returning();

  if (created) return created;

  // Lost a race against a concurrent payment; the other transaction made it.
  const [raced] = await tx
    .select()
    .from(collectionBatches)
    .where(
      tenantWhere(
        collectionBatches,
        scope,
        eq(collectionBatches.periodYear, periodYear),
        eq(collectionBatches.periodMonth, periodMonth),
      ),
    )
    .limit(1);
  if (!raced) throw new Error('Failed to open a collection batch');
  return raced;
}

/**
 * Keep the batch total in step with its payments, inside the same transaction
 * as the payment itself (SPEC §3.1 rule 3).
 */
export async function addToGross(
  tx: DbOrTx,
  scope: TenantScope,
  batchId: string,
  amountCents: number,
): Promise<void> {
  await tx
    .update(collectionBatches)
    .set({
      grossCollectedCents: sql`${collectionBatches.grossCollectedCents} + ${amountCents}`,
    })
    .where(
      and(
        tenantWhere(collectionBatches, scope, eq(collectionBatches.id, batchId)),
        eq(collectionBatches.status, 'open'),
      ),
    );
}
