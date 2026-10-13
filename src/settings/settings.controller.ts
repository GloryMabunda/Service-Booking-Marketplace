import { Body, Controller, Get, Patch, Res } from '@nestjs/common';
import type { Response } from 'express';
import { parseBody } from '../common/api-error.js';
import { CurrentUser } from '../auth/auth.guard.js';
import type { SessionUser } from '../auth/sessions.js';
import { settingsPatchSchema } from './settings.schema.js';
import { SettingsService } from './settings.service.js';

// GET and PATCH /api/admin/settings (A-8, docs/api.md section 7.15). Under
// /api/admin, so the guard requires a signed-in admin (#27). Responses hold
// banking details, so they are never cached.
@Controller('admin/settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  async get(@Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    return { settings: await this.settings.get() };
  }

  @Patch()
  async update(
    @Body() body: unknown,
    @CurrentUser() user: SessionUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const patch = parseBody(settingsPatchSchema, body);
    res.setHeader('Cache-Control', 'no-store');
    return { settings: await this.settings.update(patch, user.id) };
  }
}
