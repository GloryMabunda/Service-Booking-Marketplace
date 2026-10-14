import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { isoUtc } from '../availability/time-zone.js';
import { ApiException } from '../common/api-error.js';
import { DATABASE } from '../database/database.module.js';
import type { DB } from '../database/database.types.js';
import {
  type AdminImage,
  ImagesService,
  type ImageRow,
} from './images.service.js';
import { assertSameIds } from './ordering.js';
import type { GalleryPatch } from './site.schema.js';

export const GALLERY_LIMIT = 200;
export interface GalleryItem {
  id: string;
  caption: string | null;
  service: { id: string; name: string } | null;
  isVisible: boolean;
  position: number;
  image: AdminImage;
  consentConfirmedAt: string;
  consentConfirmedBy: { email: string };
  createdAt: string;
}

export type UploadResult =
  | { filename: string; status: 'created'; item: GalleryItem }
  | {
      filename: string;
      status: 'failed';
      error: { code: string; message: string };
    };

const notFound = () =>
  new ApiException(404, 'NOT_FOUND', 'Gallery photo not found.');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The gallery photos of the home page (A-10, BR-16, docs/api.md 7.17).
@Injectable()
export class GalleryService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly images: ImagesService,
  ) {}

  // Every item, hidden ones too, in display order
  async list() {
    const items = await this.items();
    return { items, count: items.length, limit: GALLERY_LIMIT };
  }

  // Adds the photos, each on its own: one bad file doesn't stop the others.
  // The consent confirmation has already been checked by the caller.
  async upload(
    files: { originalname?: string; buffer: Buffer }[],
    options: { serviceId?: string; adminId: string; consentAt?: Date },
  ): Promise<{ results: UploadResult[] }> {
    if (files.length === 0) {
      throw new ApiException(
        400,
        'FILE_MISSING',
        'Choose between 1 and 10 photos to upload.',
      );
    }
    await this.assertRoomFor(files.length);
    this.images.charge(options.adminId, files.length);
    if (options.serviceId) await this.assertService(options.serviceId);

    const consentAt = options.consentAt ?? new Date();
    const results: UploadResult[] = [];
    for (const file of files) {
      const filename =
        (file.originalname ?? 'photo').split(/[\\/]/).pop() ?? 'photo';
      try {
        const item = await this.addOne(
          file.buffer,
          options.adminId,
          consentAt,
          options.serviceId ?? null,
        );
        results.push({ filename, status: 'created', item });
      } catch (error) {
        if (error instanceof ApiException) {
          results.push({
            filename,
            status: 'failed',
            error: { code: error.code, message: error.message },
          });
        } else {
          throw error;
        }
      }
    }
    return { results };
  }

  async update(id: string, patch: GalleryPatch) {
    const existing = await this.find(id);
    if (patch.serviceId) await this.assertService(patch.serviceId);
    await this.db.transaction().execute(async (trx) => {
      const changes: Record<string, unknown> = {};
      if (patch.caption !== undefined) changes.caption = patch.caption;
      if (patch.serviceId !== undefined) changes.service_id = patch.serviceId;
      if (patch.isVisible !== undefined) changes.is_visible = patch.isVisible;
      if (Object.keys(changes).length > 0) {
        await trx
          .updateTable('gallery_items')
          .set({ ...changes, updated_at: new Date() })
          .where('id', '=', id)
          .execute();
      }
      // The description for screen readers belongs to the photo itself
      if (patch.altText !== undefined) {
        await trx
          .updateTable('images')
          .set({ alt_text: patch.altText })
          .where('id', '=', existing.image_id)
          .execute();
      }
    });
    return { item: await this.one(id) };
  }

  // Deletes the item, its photo record and both files
  async remove(id: string): Promise<void> {
    const item = await this.find(id);
    const image = await this.images.find(item.image_id);
    // The photo's row goes, and the item with it (ON DELETE CASCADE)
    if (image) await this.images.delete(image);
  }

  async reorder(ids: string[]) {
    const existing = await this.db
      .selectFrom('gallery_items')
      .select('id')
      .execute();
    assertSameIds(
      ids,
      existing.map((row) => row.id),
    );
    await this.db.transaction().execute(async (trx) => {
      for (const [position, id] of ids.entries()) {
        await trx
          .updateTable('gallery_items')
          .set({ position, updated_at: new Date() })
          .where('id', '=', id)
          .execute();
      }
    });
    return { items: await this.items() };
  }

  // --- Helpers ------------------------------------------------------------

  private async addOne(
    buffer: Buffer,
    adminId: string,
    consentAt: Date,
    serviceId: string | null,
  ): Promise<GalleryItem> {
    const image = await this.images.create(buffer, adminId);
    try {
      const last = await this.db
        .selectFrom('gallery_items')
        .select((eb) => eb.fn.max('position').as('last'))
        .executeTakeFirst();
      const row = await this.db
        .insertInto('gallery_items')
        .values({
          image_id: image.id,
          service_id: serviceId,
          position: (last?.last ?? -1) + 1,
          consent_confirmed_at: consentAt,
          consent_confirmed_by: adminId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return await this.one(row.id);
    } catch (error) {
      await this.images.delete(image);
      throw error;
    }
  }

  private async assertRoomFor(count: number): Promise<void> {
    const row = await this.db
      .selectFrom('gallery_items')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .executeTakeFirstOrThrow();
    if (Number(row.n) + count > GALLERY_LIMIT) {
      throw new ApiException(
        409,
        'GALLERY_FULL',
        `The gallery holds at most ${GALLERY_LIMIT} photos. Delete some to make room.`,
      );
    }
  }

  private async assertService(serviceId: string): Promise<void> {
    const service = await this.db
      .selectFrom('services')
      .select('id')
      .where('id', '=', serviceId)
      .executeTakeFirst();
    if (!service) {
      throw new ApiException(
        400,
        'VALIDATION_FAILED',
        'Some details are missing or invalid.',
        [{ field: 'serviceId', message: 'Choose a service from the list.' }],
      );
    }
  }

  private async find(id: string) {
    const row = UUID.test(id)
      ? await this.db
          .selectFrom('gallery_items')
          .selectAll()
          .where('id', '=', id)
          .executeTakeFirst()
      : undefined;
    if (!row) throw notFound();
    return row;
  }

  private async one(id: string): Promise<GalleryItem> {
    const items = await this.items(id);
    if (items.length === 0) throw notFound();
    return items[0];
  }

  private async items(onlyId?: string): Promise<GalleryItem[]> {
    const rows = await this.db
      .selectFrom('gallery_items')
      .innerJoin('images', 'images.id', 'gallery_items.image_id')
      .innerJoin('users', 'users.id', 'gallery_items.consent_confirmed_by')
      .leftJoin('services', 'services.id', 'gallery_items.service_id')
      .select([
        'gallery_items.id as item_id',
        'gallery_items.caption',
        'gallery_items.is_visible',
        'gallery_items.position',
        'gallery_items.consent_confirmed_at',
        'gallery_items.created_at as item_created_at',
        'users.email as confirmed_by_email',
        'services.id as service_id',
        'services.name as service_name',
        'images.id',
        'images.large_key',
        'images.thumb_key',
        'images.width',
        'images.height',
        'images.large_bytes',
        'images.thumb_bytes',
        'images.sha256',
        'images.alt_text',
        'images.uploaded_at',
        'images.uploaded_by',
      ])
      .$if(Boolean(onlyId), (qb) =>
        qb.where('gallery_items.id', '=', onlyId as string),
      )
      .orderBy('gallery_items.position')
      .orderBy('gallery_items.created_at')
      .orderBy('gallery_items.id')
      .execute();

    // Photos with the same hash, to point out repeats
    const hashes = rows.map((r) => r.sha256);
    const sameHash = hashes.length
      ? await this.db
          .selectFrom('gallery_items')
          .innerJoin('images', 'images.id', 'gallery_items.image_id')
          .select(['gallery_items.id as item_id', 'images.sha256'])
          .where('images.sha256', 'in', hashes)
          .execute()
      : [];

    return rows.map((row) => {
      const image: ImageRow = {
        id: row.id,
        large_key: row.large_key,
        thumb_key: row.thumb_key,
        width: row.width,
        height: row.height,
        large_bytes: row.large_bytes,
        thumb_bytes: row.thumb_bytes,
        sha256: row.sha256,
        alt_text: row.alt_text,
        uploaded_at: row.uploaded_at,
        uploaded_by: row.uploaded_by,
      };
      const duplicates = sameHash
        .filter((s) => s.item_id !== row.item_id && s.sha256.equals(row.sha256))
        .map((s) => s.item_id);
      return {
        id: row.item_id,
        caption: row.caption,
        service: row.service_id
          ? { id: row.service_id, name: row.service_name as string }
          : null,
        isVisible: row.is_visible,
        position: row.position,
        image: this.images.adminView(image, duplicates),
        consentConfirmedAt: isoUtc(new Date(row.consent_confirmed_at)),
        consentConfirmedBy: { email: row.confirmed_by_email },
        createdAt: isoUtc(new Date(row.item_created_at)),
      };
    });
  }
}
