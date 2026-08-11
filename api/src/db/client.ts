import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { env } from '../config/env.js';
import * as schema from './schema/index.js';

/**
 * Postgres hands `bigint`/`numeric` back as strings to avoid precision loss.
 * We never store money in either — it is `integer` cents everywhere (SPEC §3)
 * — but `count(*)` comes back as bigint, and silently reading it as a string
 * is how "0" + 1 = "01" bugs get into a ledger.
 */
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number.parseInt(value, 10));

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  // Supabase terminates idle connections; keep the pool small and honest.
  max: 10,
  idleTimeoutMillis: 30_000,
});

export const db: NodePgDatabase<typeof schema> = drizzle(pool, { schema });

export type Db = typeof db;
export { schema };
