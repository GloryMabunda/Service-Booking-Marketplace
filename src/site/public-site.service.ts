import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { AvailabilityService } from '../availability/availability.service.js';
import { DATABASE } from '../database/database.module.js';
import type { DB } from '../database/database.types.js';
import { SettingsService } from '../settings/settings.service.js';
import { ImagesService, type ImageRow } from './images.service.js';
import { SiteContentService } from './site-content.service.js';
import { aboutParagraphs, policyText, whatsappUrl } from './site-text.js';

// The most gallery photos the public page returns (docs/api.md 4.6)
const GALLERY_MAX = 200;

// Everything the home page needs in one call (C-9, docs/api.md 4.6, #104).
// Only visible items are returned, in display order. All text is plain text.
@Injectable()
export class PublicSiteService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly settings: SettingsService,
    private readonly availability: AvailabilityService,
    private readonly content: SiteContentService,
    private readonly images: ImagesService,
  ) {}

  async get() {
    const [settings, row, week] = await Promise.all([
      this.settings.get(),
      this.content.row(),
      this.availability.getWeek(),
    ]);
    const [hero, about] = await Promise.all([
      this.images.find(row.hero_image_id),
      this.images.find(row.about_image_id),
    ]);
    const alt = settings.businessName;

    return {
      business: {
        name: settings.businessName,
        email: settings.businessEmail,
        phone: settings.businessPhone,
      },
      content: {
        tagline: row.tagline,
        about: aboutParagraphs(row.about_text),
        heroImage: hero ? this.images.publicView(hero, alt) : null,
        aboutImage: about ? this.images.publicView(about, alt) : null,
        location:
          row.location_type && row.location_text
            ? { type: row.location_type, text: row.location_text }
            : null,
        social: {
          whatsapp: row.whatsapp_number
            ? {
                number: row.whatsapp_number,
                url: whatsappUrl(row.whatsapp_number),
              }
            : null,
          instagram: row.instagram_url,
          facebook: row.facebook_url,
          tiktok: row.tiktok_url,
        },
      },
      workingHours: {
        timeZone: week.timeZone,
        days: week.days,
      },
      policies: {
        depositPercent: settings.depositPercent,
        depositHoldHours: settings.depositHoldHours,
        minPaymentWindowHours: settings.minPaymentWindowHours,
        minNoticeHours: settings.minNoticeHours,
        maxAdvanceDays: settings.maxAdvanceDays,
        depositRefundable: settings.depositRefundable,
        refundCutoffHours: settings.refundCutoffHours,
        text: policyText(settings),
      },
      gallery: await this.gallery(alt),
      testimonials: await this.testimonials(),
      faqs: await this.faqs(),
    };
  }

  private async gallery(fallbackAlt: string) {
    const rows = await this.db
      .selectFrom('gallery_items')
      .innerJoin('images', 'images.id', 'gallery_items.image_id')
      .leftJoin('services', 'services.id', 'gallery_items.service_id')
      .select([
        'gallery_items.id as item_id',
        'gallery_items.caption',
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
      .where('gallery_items.is_visible', '=', true)
      .orderBy('gallery_items.position')
      .orderBy('gallery_items.created_at')
      .orderBy('gallery_items.id')
      .limit(GALLERY_MAX)
      .execute();
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
      // A photo with no description falls back to its caption, then the name
      const shown = this.images.publicView(
        image,
        row.caption?.trim() || fallbackAlt,
      );
      return {
        id: row.item_id,
        caption: row.caption,
        alt: shown.alt,
        service: row.service_id
          ? { id: row.service_id, name: row.service_name as string }
          : null,
        large: shown.large,
        thumb: shown.thumb,
      };
    });
  }

  private async testimonials() {
    const rows = await this.db
      .selectFrom('testimonials')
      .leftJoin('services', 'services.id', 'testimonials.service_id')
      .select([
        'testimonials.client_name',
        'testimonials.quote',
        'services.id as service_id',
        'services.name as service_name',
      ])
      .where('testimonials.is_visible', '=', true)
      .orderBy('testimonials.position')
      .orderBy('testimonials.created_at')
      .orderBy('testimonials.id')
      .execute();
    return rows.map((row) => ({
      clientName: row.client_name,
      quote: row.quote,
      service: row.service_id
        ? { id: row.service_id, name: row.service_name as string }
        : null,
    }));
  }

  private async faqs() {
    const rows = await this.db
      .selectFrom('faqs')
      .select(['question', 'answer'])
      .where('is_visible', '=', true)
      .orderBy('position')
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    return rows;
  }
}
