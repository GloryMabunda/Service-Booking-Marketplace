import {
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import multer, { MulterError } from 'multer';
import { ApiException } from '../common/api-error.js';
import { RateLimit } from '../common/rate-limit.js';
import {
  BookingLinkGuard,
  type LinkedBooking,
  type LinkedRequest,
  PerBookingLimit,
} from './booking-link.guard.js';
import { MAX_PROOF_BYTES } from './proof-file.js';
import { PublicBookingService } from './public-booking.service.js';

// Reads one file from a multipart request, in memory, refusing anything over
// 5 MB while it streams in (BR-14). Parsing happens in the handler, after the
// guard has checked the link, so nothing is read for an invalid one.
const receive = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PROOF_BYTES, files: 1, fields: 0, parts: 2 },
}).single('file');

function readFile(req: LinkedRequest, res: Response): Promise<void> {
  return new Promise((resolve, reject) => {
    receive(req, res, (error: unknown) => {
      if (!error) resolve();
      else
        reject(
          error instanceof Error
            ? error
            : new Error('Upload failed', { cause: error }),
        );
    });
  });
}

function uploadProblem(error: unknown): ApiException {
  if (error instanceof MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return new ApiException(
      413,
      'FILE_TOO_LARGE',
      'That file is too big. The most you can upload is 5 MB.',
    );
  }
  return new ApiException(
    400,
    'FILE_INVALID',
    "We couldn't read that file. Please choose a PDF, JPEG or PNG and try again.",
  );
}

// /api/booking/:token (docs/api.md section 5): everything a client can do with
// their private booking link. BookingLinkGuard checks the link first and gives
// the same 404 for any link that doesn't work.
@Controller('booking')
@UseGuards(BookingLinkGuard)
export class PublicBookingController {
  constructor(private readonly booking: PublicBookingService) {}

  // The booking page's data. Opening it never changes the booking (BR-15).
  @Get(':token')
  @RateLimit({ limit: 30, windowSeconds: 60 })
  view(@Req() req: LinkedRequest) {
    return this.booking.view(req.booking as LinkedBooking);
  }

  // Upload a proof of payment (BR-14): 10 an hour per IP, 5 an hour per booking
  @Post(':token/proofs')
  @HttpCode(201)
  @RateLimit({ limit: 10, windowSeconds: 3600 })
  @PerBookingLimit({ limit: 5, windowSeconds: 3600 })
  async uploadProof(
    @Req() req: LinkedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const link = req.booking as LinkedBooking;
    // Refused before any of the file is read
    await this.booking.assertCanUpload(link);
    try {
      await readFile(req, res);
    } catch (error) {
      throw uploadProblem(error);
    }
    if (!req.file) {
      throw new ApiException(
        400,
        'FILE_MISSING',
        'Please choose a file to upload.',
      );
    }
    return this.booking.uploadProof(
      link,
      { buffer: req.file.buffer, originalname: req.file.originalname },
      req.ip ?? 'unknown',
    );
  }

  // Cancel the booking (C-8, BR-12). A POST made by the page's confirm button,
  // so an email link scanner opening the link can't cancel anything.
  @Post(':token/cancel')
  @HttpCode(200)
  @RateLimit({ limit: 5, windowSeconds: 3600 })
  cancel(@Req() req: LinkedRequest) {
    return this.booking.cancel(req.booking as LinkedBooking);
  }
}
