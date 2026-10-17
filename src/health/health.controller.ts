import { Controller, Get, Inject, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { type Kysely, sql } from 'kysely';
import type { Env } from '../config/env.js';
import { DATABASE } from '../database/database.module.js';
import type { DB } from '../database/database.types.js';

// GET /api/health (docs/api.md 4.9, #91): is the app running and can it reach
// its database? Used by the server's health check, the deploy script and an
// outside uptime monitor. Public, and it says nothing about the system beyond
// ok or not. In demo mode it also says so (`demo: true`), which is how the
// pages know to show the demo banner, and whether the demo emails real
// addresses (`realEmail: true`).
@Controller('health')
export class HealthController {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Get()
  async check(@Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    try {
      await Promise.race([
        sql`SELECT 1`.execute(this.db),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 3_000).unref(),
        ),
      ]);
      const demo = this.config.get('DEMO_MODE', { infer: true });
      if (!demo) return { status: 'ok' };
      // The pages say so when the demo emails real addresses
      return this.config.get('DEMO_REAL_EMAIL', { infer: true })
        ? { status: 'ok', demo: true, realEmail: true }
        : { status: 'ok', demo: true };
    } catch {
      res.status(503);
      return { status: 'unavailable' };
    }
  }
}
