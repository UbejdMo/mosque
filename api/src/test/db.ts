import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import { db, pool } from '../db/client.js';
import { env } from '../config/env.js';

/**
 * Tests run against a real Postgres, never a mock — the whole point is that the
 * *database* defines what is owed.
 *
 * They also run against the same `db` handle production uses, pointed at the
 * test database by `vitest.config.ts`. A parallel connection here would mean
 * the repositories were never actually exercised.
 */
export const testDb = db;
export const testPool = pool;

/**
 * Truncating the development database would destroy real ledger data. Refuse
 * to touch anything that is not visibly a test database.
 */
function assertTestDatabase(): void {
  const url = env.DATABASE_URL;
  if (!/_test(\b|$)/.test(new URL(url).pathname)) {
    throw new Error(
      `Refusing to run destructive test setup against ${url} — expected a database whose name ends in _test`,
    );
  }
}

const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../drizzle',
);

export async function migrateTestDb(): Promise<void> {
  assertTestDatabase();
  await migrate(db, { migrationsFolder });
}

/**
 * Wipe between cases. One statement so foreign keys never dictate the order —
 * and note this is the only way `audit_logs` is ever emptied: TRUNCATE does not
 * fire the triggers that reject UPDATE and DELETE.
 */
export async function resetTestDb(): Promise<void> {
  assertTestDatabase();
  await db.execute(sql`
    TRUNCATE TABLE
      payment_allocations, payments, collection_batches, year_settlements,
      persons, households, rates, audit_logs, users, mosques
    RESTART IDENTITY CASCADE
  `);
}

let closed = false;

/**
 * Idempotent: a file with several `describe` blocks would otherwise end the
 * shared pool once per block, and the second call throws.
 */
export async function closeTestDb(): Promise<void> {
  if (closed) return;
  closed = true;
  await pool.end();
}
