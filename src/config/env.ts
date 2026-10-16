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
    // How many proxies stand between the internet and the app (for example 1
    // behind one load balancer), so the visitor's real address is used for rate
    // limits and recorded with an upload. Leave empty when nothing is in front.
    TRUST_PROXY: optionalText.transform((value, context) => {
      if (value === undefined) return undefined;
      if (!/^(?:\d|10)$/.test(value)) {
        context.addIssue({
          code: 'custom',
          message: 'must be a whole number from 0 to 10',
        });
        return z.NEVER;
      }
      return Number(value);
    }),
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
    // The address emails come from, for example: Your Business <bookings@example.com>
    MAIL_FROM: optionalText,
    // Travel fees (#115): the OpenRouteService key that finds the distance to a
    // client's address. Without it travel bookings say they are unavailable.
    OPENROUTESERVICE_API_KEY: optionalText,
    // Only for trying the app against a stand-in maps service; leave empty
    OPENROUTESERVICE_URL: optionalText.pipe(
      z.url('must be a full web address').optional(),
    ),
    // Demo mode: for trying or showing the app. No email is sent: each one is
    // kept on a demo mailbox page, so the booking link can be opened. Pages show
    // a demo banner. Never use it with real clients (docs/demo.md).
    DEMO_MODE: optionalText.transform((value, context) => {
      if (value === undefined) return false;
      if (!/^(true|false|1|0)$/i.test(value)) {
        context.addIssue({
          code: 'custom',
          message: 'must be true or false',
        });
        return z.NEVER;
      }
      return /^(true|1)$/i.test(value);
    }),
    // The public address of the site, used to build the links in emails
    PUBLIC_URL: optionalText.pipe(
      z.url('must be a full web address').optional(),
    ),
  })
  .superRefine((env, context) => {
    // In production a booking without its emails is useless to the client, and
    // links in emails need the public address (#89), so both are required.
    // The demo keeps emails on a page anyone can open, so it must never run
    // with a real email provider, which means real clients.
    if (env.DEMO_MODE && env.SMTP_HOST) {
      context.addIssue({
        code: 'custom',
        path: ['DEMO_MODE'],
        message:
          'cannot be used together with SMTP_HOST: demo mode keeps emails on a public page, so it is only for demo data',
      });
    }
    if (env.NODE_ENV === 'production' && !env.DEMO_MODE) {
      if (!env.SMTP_HOST) {
        context.addIssue({
          code: 'custom',
          path: ['SMTP_HOST'],
          message: 'is required in production, so clients get their emails',
        });
      }
      if (!env.PUBLIC_URL) {
        context.addIssue({
          code: 'custom',
          path: ['PUBLIC_URL'],
          message: 'is required in production, for the links in emails',
        });
      }
    }
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
