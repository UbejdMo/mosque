import { auditLogs } from '../db/schema/index.js';
import type { DbOrTx, TenantScope } from '../db/tenancy.js';

/**
 * The audit log (SPEC §13). Append-only, enforced by a database trigger — this
 * module is the only way rows get in.
 *
 * Every money write happens in one transaction that inserts the payment, its
 * allocations, updates the batch total *and* writes the audit row (SPEC §3.1
 * rule 3). Pass the transaction handle, never the pool, or a rolled-back write
 * will leave a log entry claiming something happened that did not.
 */
export interface AuditEntry {
  /** Dotted and past-tense: `payment.created`, `batch.confirmed`, `id_photo.viewed`. */
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}

export async function writeAudit(
  tx: DbOrTx,
  scope: TenantScope,
  entry: AuditEntry,
): Promise<void> {
  await tx.insert(auditLogs).values({
    mosqueId: scope.mosqueId,
    actorUserId: scope.actor.userId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    ip: scope.actor.ip ?? null,
    userAgent: scope.actor.userAgent ?? null,
  });
}

/**
 * For actions with no signed-in actor: the ID-photo TTL sweep, scheduled jobs.
 * `actor_user_id` stays null, which is what "the system did this" looks like.
 */
export async function writeSystemAudit(
  tx: DbOrTx,
  mosqueId: string | null,
  entry: AuditEntry,
): Promise<void> {
  await tx.insert(auditLogs).values({
    mosqueId,
    actorUserId: null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
  });
}
