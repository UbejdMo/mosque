import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv();

/**
 * Every environment variable the API reads, validated once at boot.
 * A missing or malformed variable must kill the process here — not surface as
 * a confusing 500 halfway through recording someone's payment.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.url(),
  TEST_DATABASE_URL: z.url().optional(),
  WEB_ORIGIN: z.url().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

function parseEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    // Deliberately console + exit rather than throw: this runs before the
    // logger exists, and the operator needs to read it plainly.
    console.error(`Invalid environment configuration:\n${issues}\n\nSee api/.env.example`);
    process.exit(1);
  }
  return parsed.data;
}

export const env = parseEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
