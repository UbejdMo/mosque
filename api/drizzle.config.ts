import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

loadDotenv();

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set — copy api/.env.example to api/.env');

/**
 * Migrations from commit one (SPEC §3.1). Production schema is never
 * hand-edited: every change is a generated, reviewed, committed SQL file.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
