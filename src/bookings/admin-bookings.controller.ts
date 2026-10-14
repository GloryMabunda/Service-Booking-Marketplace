import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/auth.guard.js';
import type { SessionUser } from '../auth/sessions.js';
import { parseBody } from '../common/api-error.js';
import {
  changeStatusSchema,
  confirmPaymentSchema,
  extendDeadlineSchema,
  listBookingsQuerySchema,
  recordRefundSchema,
} from './admin-booking.schema.js';
import { AdminBookingsService } from './admin-bookings.service.js';

// GET /api/admin/dashboard (A-2, docs/api.md 7.1). Like every /api/admin route
// it needs a signed-in admin (#27), and nothing here is ever cached: it holds
// clients' personal details.
@Controller('admin/dashboard')
export class AdminDashboardController {
  constructor(private readonly bookings: AdminBookingsService) {}

  @Get()
  get(@Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    return this.bookings.dashboard();
  }
}

// /api/admin/bookings (A-3, A-4, docs/api.md 7.2 to 7.8)
@Controller('admin/bookings')
export class AdminBookingsController {
  constructor(private readonly bookings: AdminBookingsService) {}

  @Get()
  list(@Query() query: unknown, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    return this.bookings.list(parseBody(listBookingsQuerySchema, query));
  }

  @Get(':id')
  get(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    return this.bookings.get(id);
  }

  @Post(':id/confirm-payment')
  @HttpCode(200)
  confirmPayment(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: SessionUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { amountReceived } = parseBody(confirmPaymentSchema, body);
    res.setHeader('Cache-Control', 'no-store');
    return this.bookings.confirmPayment(id, amountReceived, user.id);
  }

  @Patch(':id/deadline')
  extendDeadline(
    @Param('id') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { depositDueAt } = parseBody(extendDeadlineSchema, body);
    res.setHeader('Cache-Control', 'no-store');
    return this.bookings.extendDeadline(id, depositDueAt);
  }

  @Patch(':id/status')
  changeStatus(
    @Param('id') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const change = parseBody(changeStatusSchema, body);
    res.setHeader('Cache-Control', 'no-store');
    return this.bookings.changeStatus(id, change);
  }

  @Post(':id/refund')
  @HttpCode(200)
  recordRefund(
    @Param('id') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    parseBody(recordRefundSchema, body ?? {});
    res.setHeader('Cache-Control', 'no-store');
    return this.bookings.recordRefund(id);
  }

  @Post(':id/booking-link')
  @HttpCode(202)
  reissueLink(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.bookings.reissueLink(id);
  }
}
