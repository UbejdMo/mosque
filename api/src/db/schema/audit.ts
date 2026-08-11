import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { mosques } from './mosques.js';
import { users } from './users.js';

/**
 * Append-only (SPEC §13). No `updated_at` column, because a row here is never
 * updated — a trigger rejects UPDATE and DELETE outright, so this holds even
 * for the database owner, who could otherwise revoke its way around a GRANT.
 *
 * Every mutation and every ID-photo view writes a row here (SPEC §8).
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Null for cross-tenant actions by a super_admin. */
    mosqueId: uuid('mosque_id').references(() => mosques.id, { onDelete: 'restrict' }),
    /** Null for system actions such as the ID-photo TTL sweep. */
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'restrict' }),
    /** e.g. `payment.created`, `batch.confirmed`, `id_photo.viewed`. */
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_logs_mosque_created_idx').on(t.mosqueId, t.createdAt),
    index('audit_logs_entity_idx').on(t.entityType, t.entityId),
    index('audit_logs_actor_idx').on(t.actorUserId),
  ],
);
