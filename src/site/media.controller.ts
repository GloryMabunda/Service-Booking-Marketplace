import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiException } from '../common/api-error.js';
import { RateLimit } from '../common/rate-limit.js';
import { StoredFileNotFoundError } from '../storage/file-storage.js';
import { ImagesService } from './images.service.js';

// GET /media/:key (docs/api.md 4.7): a website photo. Not under /api, because
// it returns a file. Only keys in the images table are served, and only from
// the public storage area: proofs of payment live in the private area and
// can't be reached here. The key is random and never reused, so a key always
// means the same picture and may be cached for good.
@Controller('media')
export class MediaController {
  constructor(private readonly images: ImagesService) {}

  @Get(':file')
  @RateLimit({ limit: 600, windowSeconds: 60 })
  async get(@Param('file') file: string, @Res() res: Response) {
    // "<64 hex characters>.webp"
    const match = /^([a-f0-9]{16,128})\.webp$/.exec(file);
    const image = match ? await this.images.findByKey(match[1]) : null;
    if (!match || !image) throw notFound();
    try {
      const data = await this.images.readPublic(match[1]);
      res.status(200);
      res.setHeader('Content-Type', 'image/webp');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Length', String(data.length));
      res.end(data);
    } catch (error) {
      if (error instanceof StoredFileNotFoundError) throw notFound();
      throw error;
    }
  }
}

const notFound = () => new ApiException(404, 'NOT_FOUND', 'Not found.');
