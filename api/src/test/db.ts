import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import * as schema from '../db/schema/index.js';

/**
 * The golden-case suite runs against a real Postgres, never a mock. The whole
 * point of these tests is that the *database* defines what is owed — a mocked
 * view would prove nothing.
 */
const connectionString =
  process.env.TEST_DATABASE_URL ?? 'postgres://mosque:mosque@localhost:5434/mosque_test';

pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number.parseInt(value, 10));

export const testPool = new pg.Pool({ connectionString, max: 4 });
export const testDb: NodePgDatabase<typeof schema> = drizzle(testPool, { schema });

const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../drizzle',
);

export async function migrateTestDb(): Promise<void> {
  await migrate(testDb, { migrationsFolder });
}

/**
 * Wipe between cases. RESTART IDENTITY CASCADE in one statement so foreign
 * keys never dictate the order — and note this is the one place `audit_logs`
 * may be emptied: TRUNCATE does not fire the row/statement triggers that
 * reject UPDATE and DELETE.
 */
export async function resetTestDb(): Promise<void> {
  await testDb.execute(sql`
    TRUNCATE TABLE
      payment_allocations, payments, collection_batches, year_settlements,
      persons, households, rates, audit_logs, users, mosques
    RESTART IDENTITY CASCADE
  `);
}

export async function closeTestDb(): Promise<void> {
  await testPool.end();
}
