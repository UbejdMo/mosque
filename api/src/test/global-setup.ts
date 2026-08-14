import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

/**
 * Migrates the test database exactly once per run, before any test file loads.
 *
 * Previously every file did this in its own `beforeAll`. Drizzle's migrator is
 * idempotent, so it worked, but eight files racing for the same migrations
 * table is a deadlock waiting to happen — and a suite that fails at setup tells
 * you nothing about the code.
 *
 * Uses its own short-lived connection: `test.env` applies to the test
 * environment, not to this file.
 */
export async function setup(): Promise<void> {
  const connectionString =
    process.env.TEST_DATABASE_URL ?? 'postgres://mosque:mosque@localhost:5434/mosque_test';

  if (!/_test(\b|$)/.test(new URL(connectionString).pathname)) {
    throw new Error(`Refusing to migrate ${connectionString} — expected a database named *_test`);
  }

  const pool = new pg.Pool({ connectionString, max: 1 });
  try {
    await migrate(drizzle(pool), {
      migrationsFolder: path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../drizzle',
      ),
    });
  } finally {
    await pool.end();
  }
}
