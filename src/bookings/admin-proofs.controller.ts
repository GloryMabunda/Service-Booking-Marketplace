import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/auth.guard.js';
import type { SessionUser } from '../auth/sessions.js';
import { parseBody } from '../common/api-error.js';
import {
  calendarQuerySchema,
  proofFileQuerySchema,
  reviewProofSchema,
} from './admin-booking.schema.js';
import { AdminCalendarService } from './admin-calendar.service.js';
import { AdminProofsService } from './admin-proofs.service.js';

// /api/admin/payment-proofs (A-9, BR-14, docs/api.md 7.9 and 7.10). Like every
// /api/admin route it needs a signed-in admin (#27): a proof file is never
// served to anyone else.
@Controller('admin/payment-proofs')
export class AdminProofsController {
  constructor(private readonly proofs: AdminProofsService) {}

  // The file itself. The type was found from the file's bytes when it was
  // uploaded, so it is shown inline only as PDF, JPEG or PNG; the name is
  // built from the booking reference, never the uploaded filename; and
  // nosniff stops a browser from guessing a different type.
  @Get(':id/file')
  async file(
    @Param('id') id: string,
    @Query() query: unknown,
    @Res() res: Response,
  ) {
    const { download } = parseBody(proofFileQuerySchema, query);
    const file = await this.proofs.file(id);
    res.status(200);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader(
      'Content-Disposition',
      `${download ? 'attachment' : 'inline'}; filename="${file.filename}"`,
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Length', String(file.data.length));
    res.end(file.data);
  }

  @Patch(':id')
  review(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: SessionUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const change = parseBody(reviewProofSchema, body);
    res.setHeader('Cache-Control', 'no-store');
    return this.proofs.review(
      id,
      change.status === 'accepted'
        ? { status: 'accepted' }
        : {
            status: 'rejected',
            // The schema guarantees a reason when rejecting
            rejectionReason: change.rejectionReason as string,
          },
      user.id,
    );
  }
}

// GET /api/admin/calendar (A-7, docs/api.md 7.11)
@Controller('admin/calendar')
export class AdminCalendarController {
  constructor(private readonly calendar: AdminCalendarService) {}

  @Get()
  get(@Query() query: unknown, @Res({ passthrough: true }) res: Response) {
    const { from, to, includeCancelled } = parseBody(
      calendarQuerySchema,
      query,
    );
    res.setHeader('Cache-Control', 'no-store');
    return this.calendar.get(from, to, includeCancelled);
  }
}
