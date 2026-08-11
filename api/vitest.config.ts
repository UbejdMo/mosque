import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test files share one Postgres and truncate between cases, so they must
    // not run against it concurrently.
    fileParallelism: false,
    env: { NODE_ENV: 'test' },
    include: ['src/**/*.test.ts'],
  },
});
