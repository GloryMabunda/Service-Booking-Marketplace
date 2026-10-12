import { z } from 'zod';

// Every environment variable the app reads, with its rules (#20). Add new ones
// here and to .env.example in the same change.
// ADMIN_EMAIL and ADMIN_PASSWORD are read only by npm run seed:admin; their
// rules are in src/auth/seed-admin.ts (#26).
const postgresUrl = z
  .string()
  .regex(/^postgres(ql)?:\/\/.+/, 'must be a postgres:// connection string');

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce
    .number({ error: 'must be a whole number between 1 and 65535' })
    .int('must be a whole number between 1 and 65535')
    .min(1, 'must be a whole number between 1 and 65535')
    .max(65535, 'must be a whole number between 1 and 65535')
    .default(3000),
  DATABASE_URL: postgresUrl,
  // Only the automated tests use this, so it is optional for the app itself.
  TEST_DATABASE_URL: postgresUrl.optional(),
});

export type Env = z.infer<typeof envSchema>;

// Checks the variables and returns them typed, or throws one error that lists
// every problem, so a missing or wrong setting stops the app at startup.
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (result.success) return result.data;

  const problems = result.error.issues.map((issue) => {
    const name = issue.path.join('.');
    const missing = issue.code === 'invalid_type' && raw[name] === undefined;
    return `  - ${name}: ${missing ? 'is required but not set' : issue.message}`;
  });
  throw new Error(
    `Invalid environment configuration:\n${problems.join('\n')}\n` +
      'Copy .env.example to .env and fill in the values (see README).',
  );
}
