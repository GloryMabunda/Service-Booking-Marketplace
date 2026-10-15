import { Body, Controller, HttpCode, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { parseBody } from '../common/api-error.js';
import { RateLimit } from '../common/rate-limit.js';
import { travelQuoteSchema } from './travel.schema.js';
import { TravelService } from './travel.service.js';

// POST /api/travel/quote (docs/api.md 4.2a, #115): public. Each call may ask
// the maps service, which has a daily allowance, so it is limited tightly and
// the provider remembers recent answers.
@Controller('travel')
export class TravelController {
  constructor(private readonly travel: TravelService) {}

  @Post('quote')
  @HttpCode(200)
  @RateLimit({ limit: 15, windowSeconds: 60 })
  quote(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    const { serviceId, address } = parseBody(travelQuoteSchema, body);
    return this.travel.quote(serviceId, address);
  }
}
