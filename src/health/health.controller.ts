import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { type Kysely, sql } from 'kysely';
import { DATABASE } from '../database/database.module.js';
import type { DB } from '../database/database.types.js';

// GET /api/health (docs/api.md 4.9, #91): is the app running and can it reach
// its database? Used by the server's health check, the deploy script and an
// outside uptime monitor. Public, and it says nothing about the system beyond
// ok or not.
@Controller('health')
export class HealthController {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

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
      return { status: 'ok' };
    } catch {
      res.status(503);
      return { status: 'unavailable' };
    }
  }
}
