import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Kysely, Selectable } from 'kysely';
import {
  RATE_LIMITER,
  RateLimitedException,
  type SlidingWindowLimiter,
} from '../common/rate-limit.js';
import { DATABASE } from '../database/database.module.js';
import type { DB } from '../database/database.types.js';
import { isoUtc } from '../availability/time-zone.js';
import {
  FILE_STORAGE,
  type FileStorage,
  newStorageKey,
} from '../storage/file-storage.js';
import { processImage, thumbSize } from './image-processing.js';

export type ImageRow = Selectable<DB['images']>;

const PHOTOS_PER_HOUR = 60;

// The address a stored photo is served from (docs/api.md 4.7). Keys are random
// and never reused, so an address always means the same picture.
export const mediaUrl = (key: string) => `/media/${key}.webp`;

// A photo as the public site sees it (docs/api.md 4.6)
export interface PublicImage {
  alt: string;
  large: { url: string; width: number; height: number };
  thumb: { url: string; width: number; height: number };
}

// A photo as the owner sees it (docs/api.md, "AdminImage")
export interface AdminImage {
  id: string;
  altText: string | null;
  width: number;
  height: number;
  large: { url: string };
  thumb: { url: string };
  // Gallery items that use a photo with the same SHA-256, to spot a repeat
  duplicateOf: string[];
  uploadedAt: string;
}

// Website photos (BR-16, #106): processed, stored in the public area and
// recorded in the images table.
@Injectable()
export class ImagesService {
  private readonly logger = new Logger(ImagesService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    @Inject(RATE_LIMITER) private readonly limiter: SlidingWindowLimiter,
  ) {}

  // At most 60 photos an hour for the whole portal (docs/api.md, "Photo
  // uploads"): each photo about to be processed counts once.
  charge(adminId: string, count: number): void {
    for (let i = 0; i < count; i++) {
      const result = this.limiter.consume(
        `photo-upload|${adminId}`,
        PHOTOS_PER_HOUR,
        3_600_000,
      );
      if (!result.allowed) {
        throw new RateLimitedException(result.resetSeconds, result.limit);
      }
    }
  }

  // Processes an uploaded photo and saves it. Throws the upload errors of
  // docs/api.md ("Photo uploads") for a file that can't be used; if recording
  // it fails, the files are removed again.
  async create(
    upload: Buffer,
    uploadedBy: string,
    altText: string | null = null,
    executor: Kysely<DB> = this.db,
  ): Promise<ImageRow> {
    const processed = await processImage(upload);
    const largeKey = newStorageKey();
    const thumbKey = newStorageKey();
    await this.storage.save('public', largeKey, processed.large);
    try {
      await this.storage.save('public', thumbKey, processed.thumb);
      return await executor
        .insertInto('images')
        .values({
          large_key: largeKey,
          thumb_key: thumbKey,
          width: processed.width,
          height: processed.height,
          large_bytes: processed.large.length,
          thumb_bytes: processed.thumb.length,
          // Of the original upload, so the same photo uploaded twice is noticed
          sha256: createHash('sha256').update(upload).digest(),
          alt_text: altText,
          uploaded_by: uploadedBy,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    } catch (error) {
      await this.removeFiles(largeKey, thumbKey);
      throw error;
    }
  }

  // Deletes the record and both files. The files go after the record, so a
  // failure leaves at worst a stray file, never a record without a file.
  async delete(image: Pick<ImageRow, 'id' | 'large_key' | 'thumb_key'>) {
    await this.db.deleteFrom('images').where('id', '=', image.id).execute();
    await this.removeFiles(image.large_key, image.thumb_key);
  }

  async find(id: string | null): Promise<ImageRow | null> {
    if (!id) return null;
    return (
      (await this.db
        .selectFrom('images')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst()) ?? null
    );
  }

  async findMany(ids: (string | null)[]): Promise<Map<string, ImageRow>> {
    const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
    if (wanted.length === 0) return new Map();
    const rows = await this.db
      .selectFrom('images')
      .selectAll()
      .where('id', 'in', wanted)
      .execute();
    return new Map(rows.map((row) => [row.id, row]));
  }

  // The photo behind a /media key: a large or a thumbnail key
  async findByKey(key: string): Promise<ImageRow | null> {
    return (
      (await this.db
        .selectFrom('images')
        .selectAll()
        .where((eb) =>
          eb.or([eb('large_key', '=', key), eb('thumb_key', '=', key)]),
        )
        .executeTakeFirst()) ?? null
    );
  }

  readPublic(key: string): Promise<Buffer> {
    return this.storage.read('public', key);
  }

  publicView(image: ImageRow, fallbackAlt: string): PublicImage {
    const thumb = thumbSize(image.width, image.height);
    return {
      alt: image.alt_text?.trim() || fallbackAlt,
      large: {
        url: mediaUrl(image.large_key),
        width: image.width,
        height: image.height,
      },
      thumb: { url: mediaUrl(image.thumb_key), ...thumb },
    };
  }

  // `duplicates` are the gallery item ids that use a photo with the same hash
  adminView(image: ImageRow, duplicates: string[] = []): AdminImage {
    return {
      id: image.id,
      altText: image.alt_text,
      width: image.width,
      height: image.height,
      large: { url: mediaUrl(image.large_key) },
      thumb: { url: mediaUrl(image.thumb_key) },
      duplicateOf: duplicates,
      uploadedAt: isoUtc(new Date(image.uploaded_at)),
    };
  }

  // Gallery items that use another photo with the same hash as `image`
  async duplicatesOf(image: ImageRow): Promise<string[]> {
    const rows = await this.db
      .selectFrom('gallery_items')
      .innerJoin('images', 'images.id', 'gallery_items.image_id')
      .select('gallery_items.id')
      .where('images.sha256', '=', image.sha256)
      .where('images.id', '!=', image.id)
      .execute();
    return rows.map((row) => row.id);
  }

  private async removeFiles(...keys: string[]): Promise<void> {
    for (const key of keys) {
      await this.storage.delete('public', key).catch((error: unknown) => {
        this.logger.error(
          `Could not remove photo file ${key}: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }
  }
}
