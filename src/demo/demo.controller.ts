import { Controller, Get, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { ApiException } from '../common/api-error.js';
import { RateLimit } from '../common/rate-limit.js';
import type { Env } from '../config/env.js';
import { DemoMailbox } from './demo-mailbox.js';

// GET /api/demo/emails (docs/api.md 4.10): the emails the demo "sent". Only
// exists in demo mode; anywhere else it is a plain 404, as if it were never
// there, because the emails hold booking links.
@Controller('demo')
export class DemoController {
  constructor(
    private readonly mailbox: DemoMailbox,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Get('emails')
  @RateLimit({ limit: 60, windowSeconds: 60 })
  emails(@Res({ passthrough: true }) res: Response) {
    if (!this.config.get('DEMO_MODE', { infer: true })) {
      throw new ApiException(404, 'NOT_FOUND', 'Not found.');
    }
    res.setHeader('Cache-Control', 'no-store');
    return { emails: this.mailbox.list() };
  }
}
