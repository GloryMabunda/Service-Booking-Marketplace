import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

// Request logging that never records a booking link token (spec section 9,
// #68). A link like /booking/<token> or /api/booking/<token>/proofs is logged
// as /booking/***, so a log file can't be used to open someone's booking.
export function maskBookingToken(url: string): string {
  return url.replace(/(\/booking\/)[^/?#\s]+/gi, '$1***');
}

const logger = new Logger('HTTP');

// Logs each API and booking page request once it has been answered. Files of
// the website itself (styles, scripts, images) are left out to keep the log
// readable.
export function requestLogger() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const started = Date.now();
    res.on('finish', () => {
      const url = req.originalUrl;
      if (!url.startsWith('/api/') && !url.startsWith('/booking/')) return;
      logger.log(
        `${req.method} ${maskBookingToken(url)} ${res.statusCode} ${Date.now() - started}ms`,
      );
    });
    next();
  };
}
