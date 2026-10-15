// node dist/scripts/seed-demo.js (docs/demo.md): fills an empty database with
// made-up demo data. Does nothing when there already are services. The demo
// administrator is demo@example.com; the password is DEMO_ADMIN_PASSWORD, or
// "demo-admin-1234" when that isn't set (change it on anything public).
import { existsSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import {
  DEFAULT_DEMO_ADMIN_PASSWORD,
  DEMO_ADMIN_EMAIL,
  seedDemo,
} from '../demo/seed-demo.js';

async function main(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  // Demo data belongs only in a demo: refuse anywhere else
  if (!/^(true|1)$/i.test(process.env.DEMO_MODE ?? '')) {
    throw new Error(
      'Demo data is only added in demo mode. Set DEMO_MODE=true to use it.',
    );
  }
  const password =
    process.env.DEMO_ADMIN_PASSWORD || DEFAULT_DEMO_ADMIN_PASSWORD;
  if (password.length < 12) {
    throw new Error('DEMO_ADMIN_PASSWORD must be at least 12 characters');
  }
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  try {
    const result = await seedDemo(app, password);
    console.log(
      result === 'seeded'
        ? `Added the demo data. Sign in at /admin/ as ${DEMO_ADMIN_EMAIL}`
        : 'The demo data is already there (the database has services)',
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
