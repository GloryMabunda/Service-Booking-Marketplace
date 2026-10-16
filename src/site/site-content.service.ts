import { Inject, Injectable } from '@nestjs/common';
import type { Kysely, Selectable } from 'kysely';
import { isoUtc } from '../availability/time-zone.js';
import { ApiException } from '../common/api-error.js';
import { DATABASE } from '../database/database.module.js';
import type { DB } from '../database/database.types.js';
import { type AdminImage, ImagesService } from './images.service.js';
import type { SiteContentPatch } from './site.schema.js';

type ContentRow = Selectable<DB['site_content']>;
export type ImageSlot = 'hero' | 'about' | 'logo';

export interface AdminSiteContent {
  tagline: string | null;
  aboutText: string;
  heroImage: AdminImage | null;
  aboutImage: AdminImage | null;
  // The business logo, shown in the header, footer and pages
  logoImage: AdminImage | null;
  locationType: 'travel' | 'studio' | null;
  locationText: string | null;
  whatsappNumber: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  tiktokUrl: string | null;
  updatedAt: string;
}

const COLUMN = {
  hero: 'hero_image_id',
  about: 'about_image_id',
  logo: 'logo_image_id',
} as const;

// The text, links and two photos of the home page (A-10, docs/api.md 7.16).
@Injectable()
export class SiteContentService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly images: ImagesService,
  ) {}

  // The single content row. Made if it doesn't exist yet, so a database that
  // missed the seed still works.
  async row(executor: Kysely<DB> = this.db): Promise<ContentRow> {
    await executor
      .insertInto('site_content')
      .values({ id: 1 })
      .onConflict((oc) => oc.column('id').doNothing())
      .execute();
    return executor
      .selectFrom('site_content')
      .selectAll()
      .where('id', '=', 1)
      .executeTakeFirstOrThrow();
  }

  async get(): Promise<{ content: AdminSiteContent }> {
    return { content: await this.view(await this.row()) };
  }

  async update(patch: SiteContentPatch, adminId: string) {
    await this.db.transaction().execute(async (trx) => {
      const current = await this.row(trx);
      const changes: Record<string, unknown> = {};
      if (patch.tagline !== undefined) changes.tagline = patch.tagline;
      if (patch.aboutText !== undefined) changes.about_text = patch.aboutText;
      if (patch.locationType !== undefined) {
        changes.location_type = patch.locationType;
        changes.location_text = patch.locationText ?? null;
      }
      if (patch.whatsappNumber !== undefined)
        changes.whatsapp_number = patch.whatsappNumber;
      if (patch.instagramUrl !== undefined)
        changes.instagram_url = patch.instagramUrl;
      if (patch.facebookUrl !== undefined)
        changes.facebook_url = patch.facebookUrl;
      if (patch.tiktokUrl !== undefined) changes.tiktok_url = patch.tiktokUrl;

      // A photo's alt text lives on the photo, so there must be one
      for (const [slot, alt] of [
        ['hero', patch.heroImageAlt],
        ['about', patch.aboutImageAlt],
        ['logo', patch.logoImageAlt],
      ] as const) {
        if (alt === undefined) continue;
        const imageId = current[COLUMN[slot]];
        if (!imageId) {
          throw new ApiException(
            400,
            'VALIDATION_FAILED',
            'Some details are missing or invalid.',
            [
              {
                field: `${slot}ImageAlt`,
                message: 'Upload the photo first, then describe it.',
              },
            ],
          );
        }
        await trx
          .updateTable('images')
          .set({ alt_text: alt })
          .where('id', '=', imageId)
          .execute();
      }

      await trx
        .updateTable('site_content')
        .set({ ...changes, updated_at: new Date(), updated_by: adminId })
        .where('id', '=', 1)
        .execute();
    });
    return this.get();
  }

  // Puts a new photo in a slot and removes the one it replaces (and its files)
  async setImage(
    slot: ImageSlot,
    upload: Buffer,
    adminId: string,
    altText: string | null,
  ) {
    const column = COLUMN[slot];
    const before = await this.row();
    const created = await this.images.create(upload, adminId, altText);
    try {
      await this.db
        .updateTable('site_content')
        .set({
          [column]: created.id,
          updated_at: new Date(),
          updated_by: adminId,
        })
        .where('id', '=', 1)
        .execute();
    } catch (error) {
      await this.images.delete(created);
      throw error;
    }
    const old = await this.images.find(before[column]);
    if (old) await this.images.delete(old);
    return this.get();
  }

  async removeImage(slot: ImageSlot, adminId: string): Promise<void> {
    const column = COLUMN[slot];
    const current = await this.row();
    const old = await this.images.find(current[column]);
    await this.db
      .updateTable('site_content')
      .set({ [column]: null, updated_at: new Date(), updated_by: adminId })
      .where('id', '=', 1)
      .execute();
    if (old) await this.images.delete(old);
  }

  private async view(row: ContentRow): Promise<AdminSiteContent> {
    const [hero, about, logo] = await Promise.all([
      this.images.find(row.hero_image_id),
      this.images.find(row.about_image_id),
      this.images.find(row.logo_image_id),
    ]);
    return {
      tagline: row.tagline,
      aboutText: row.about_text,
      heroImage: hero
        ? this.images.adminView(hero, await this.images.duplicatesOf(hero))
        : null,
      aboutImage: about
        ? this.images.adminView(about, await this.images.duplicatesOf(about))
        : null,
      logoImage: logo
        ? this.images.adminView(logo, await this.images.duplicatesOf(logo))
        : null,
      locationType: row.location_type,
      locationText: row.location_text,
      whatsappNumber: row.whatsapp_number,
      instagramUrl: row.instagram_url,
      facebookUrl: row.facebook_url,
      tiktokUrl: row.tiktok_url,
      updatedAt: isoUtc(new Date(row.updated_at)),
    };
  }
}
