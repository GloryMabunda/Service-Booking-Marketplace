import { z } from 'zod';

// Every environment variable the app reads, with its rules (#20). Add new ones
// here and to .env.example in the same change.
// ADMIN_EMAIL and ADMIN_PASSWORD are read only by npm run seed:admin; their
// rules are in src/auth/seed-admin.ts (#26).
const postgresUrl = z
  .string()
  .regex(/^postgres(ql)?:\/\/.+/, 'must be a postgres:// connection string');

// A blank value in .env (SMTP_HOST=) means "not set"
const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || undefined);

export const envSchema = z
  .object({
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
    // Where uploaded files are kept by the local disk provider (#67)
    UPLOAD_DIR: optionalText,
    // Email (M5, #55). Without SMTP_HOST no email is sent: bookings still work
    // and say honestly that the email didn't go.
    SMTP_HOST: optionalText,
    SMTP_PORT: z.coerce
      .number({ error: 'must be a whole number between 1 and 65535' })
      .int('must be a whole number between 1 and 65535')
      .min(1, 'must be a whole number between 1 and 65535')
      .max(65535, 'must be a whole number between 1 and 65535')
      .default(587),
    SMTP_USER: optionalText,
    SMTP_PASSWORD: optionalText,
    // The address emails come from, for example: Make Up by Glory <bookings@example.com>
    MAIL_FROM: optionalText,
    // The public address of the site, used to build the links in emails
    PUBLIC_URL: optionalText.pipe(
      z.url('must be a full web address').optional(),
    ),
  })
  .superRefine((env, context) => {
    if (env.SMTP_HOST && !env.MAIL_FROM) {
      context.addIssue({
        code: 'custom',
        path: ['MAIL_FROM'],
        message: 'is required when SMTP_HOST is set',
      });
    }
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
