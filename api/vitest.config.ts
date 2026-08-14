import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test files share one Postgres and truncate between cases, so they must
    // not run against it concurrently.
    fileParallelism: false,
    /**
     * Point the application's own `db` handle at the test database, so tests
     * exercise the real repositories. Set here rather than in `api/.env`
     * because dotenv does not override variables that are already present —
     * these win.
     */
    env: {
      NODE_ENV: 'test',
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ?? 'postgres://mosque:mosque@localhost:5434/mosque_test',
      JWT_SECRET: 'test-secret-that-is-comfortably-over-32-characters',
    },
    include: ['src/**/*.test.ts'],
  },
});
