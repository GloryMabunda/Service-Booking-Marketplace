import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Kysely, Selectable } from 'kysely';
import sharp from 'sharp';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { configureApp } from '../../src/app.factory.js';
import { AppModule } from '../../src/app.module.js';
import {
  RATE_LIMITER,
  type SlidingWindowLimiter,
} from '../../src/common/rate-limit.js';
import type { DB } from '../../src/database/database.types.js';
import { FILE_STORAGE, newStorageKey } from '../../src/storage/file-storage.js';
import { LocalFileStorage } from '../../src/storage/local-file-storage.js';
import {
  removeTestAdmin,
  signInTestAdmin,
  type TestAdmin,
} from '../helpers/admin.js';
import { createTestDatabase } from '../helpers/database.js';
import { bodyOf, errorBody } from '../helpers/http.js';

// The home page content: GET /api/site, /media/:key and the owner's endpoints
// for About, contact, photos, gallery, testimonials and FAQ (C-9, A-10, BR-16;
// docs/api.md 4.6, 4.7, 7.16 to 7.18).

const PREFIX = 'Site test ';
const colour = (n: number) => ({
  r: (n * 40) % 255,
  g: (n * 90) % 255,
  b: (n * 150) % 255,
});
const jpeg = (width = 40, height = 30, n = 1) =>
  sharp({ create: { width, height, channels: 3, background: colour(n) } })
    .jpeg()
    .toBuffer();

interface Image {
  id: string;
  altText: string | null;
  width: number;
  height: number;
  large: { url: string };
  thumb: { url: string };
  duplicateOf: string[];
}
interface GalleryItem {
  id: string;
  caption: string | null;
  service: { id: string; name: string } | null;
  isVisible: boolean;
  position: number;
  image: Image;
  consentConfirmedBy: { email: string };
}
interface Content {
  tagline: string | null;
  aboutText: string;
  heroImage: Image | null;
  aboutImage: Image | null;
  logoImage: Image | null;
  locationType: string | null;
  locationText: string | null;
  whatsappNumber: string | null;
  instagramUrl: string | null;
}

describe('Home page content API', () => {
  let db: Kysely<DB>;
  let app: INestApplication<App>;
  let admin: TestAdmin;
  let storage: LocalFileStorage;
  let uploadDir: string;
  let service: { id: string };
  let originalSettings: Selectable<DB['settings']>;

  beforeAll(async () => {
    db = createTestDatabase();
    originalSettings = await db
      .selectFrom('settings')
      .selectAll()
      .executeTakeFirstOrThrow();
    uploadDir = await mkdtemp(join(tmpdir(), 'mbg-site-'));
    storage = new LocalFileStorage(uploadDir);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FILE_STORAGE)
      .useValue(storage)
      .compile();
    app = moduleRef.createNestApplication<INestApplication<App>>({
      logger: false,
    });
    configureApp(app);
    await app.init();
    admin = await signInTestAdmin(app, db, 'site-test@example.com');
    service = await db
      .insertInto('services')
      .values({
        name: `${PREFIX}Laundry`,
        price: '650.00',
        duration_minutes: 90,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
  });

  beforeEach(() => {
    app.get<SlidingWindowLimiter>(RATE_LIMITER).reset();
  });

  afterEach(async () => {
    await resetContent(db);
    for (const key of await storage.list('public')) {
      await storage.delete('public', key);
    }
    for (const key of await storage.list('private')) {
      await storage.delete('private', key);
    }
    await db
      .updateTable('settings')
      .set({
        deposit_percent: originalSettings.deposit_percent,
        deposit_refundable: originalSettings.deposit_refundable,
      })
      .where('id', '=', 1)
      .execute();
  });

  afterAll(async () => {
    await resetContent(db);
    await db
      .deleteFrom('services')
      .where('name', 'like', `${PREFIX}%`)
      .execute();
    await removeTestAdmin(db, admin);
    await app.close();
    await db.destroy();
    await rm(uploadDir, { recursive: true, force: true });
  });

  const http = () => request(app.getHttpServer());
  const as = (r: request.Test) => r.set('Cookie', admin.cookie);
  const site = () => http().get('/api/site');
  const getContent = async () =>
    bodyOf<{ content: Content }>(
      await as(http().get('/api/admin/site-content')),
    ).content;
  const patchContent = (body: object) =>
    as(http().patch('/api/admin/site-content')).send(body);
  const putImage = (
    slot: string,
    file: Buffer,
    filename = 'p.jpg',
    alt?: string,
  ) => {
    const r = as(http().put(`/api/admin/site-content/images/${slot}`)).attach(
      'file',
      file,
      { filename, contentType: 'image/jpeg' },
    );
    return alt === undefined ? r : r.field('altText', alt);
  };
  const upload = (
    files: Buffer[],
    options: { consent?: boolean; serviceId?: string } = { consent: true },
  ) => {
    let r = as(http().post('/api/admin/gallery'));
    for (const [i, f] of files.entries()) {
      r = r.attach('files', f, {
        filename: `photo${i}.jpg`,
        contentType: 'image/jpeg',
      });
    }
    if (options.consent) r = r.field('consent', 'true');
    if (options.serviceId) r = r.field('serviceId', options.serviceId);
    return r;
  };
  const gallery = async () =>
    bodyOf<{ items: GalleryItem[]; count: number; limit: number }>(
      await as(http().get('/api/admin/gallery')),
    );
  const created = (res: request.Response) =>
    bodyOf<{
      results: {
        status: string;
        item?: GalleryItem;
        error?: { code: string };
        filename: string;
      }[];
    }>(res).results;

  describe('who may manage it', () => {
    it.each([
      ['GET', '/api/admin/site-content'],
      ['PATCH', '/api/admin/site-content'],
      ['PUT', '/api/admin/site-content/images/hero'],
      ['DELETE', '/api/admin/site-content/images/hero'],
      ['GET', '/api/admin/gallery'],
      ['POST', '/api/admin/gallery'],
      ['PUT', '/api/admin/gallery/order'],
      ['PATCH', '/api/admin/gallery/00000000-0000-0000-0000-000000000000'],
      ['DELETE', '/api/admin/gallery/00000000-0000-0000-0000-000000000000'],
      ['GET', '/api/admin/testimonials'],
      ['POST', '/api/admin/testimonials'],
      ['GET', '/api/admin/faqs'],
      ['POST', '/api/admin/faqs'],
    ])('%s %s needs a signed-in admin', async (method, path) => {
      const res = await http()[method.toLowerCase() as 'get'](path);
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/site (#104)', () => {
    it('starts empty: nothing to show, so every section is hidden', async () => {
      const res = await site();
      expect(res.status).toBe(200);
      const body = bodyOf<Record<string, unknown>>(res);
      expect(body.business).toMatchObject({
        name: expect.any(String) as string,
      });
      expect(body.content).toEqual({
        tagline: null,
        about: [],
        heroImage: null,
        aboutImage: null,
        logoImage: null,
        location: null,
        social: {
          whatsapp: null,
          instagram: null,
          facebook: null,
          tiktok: null,
        },
      });
      expect(body.gallery).toEqual([]);
      expect(body.testimonials).toEqual([]);
      expect(body.faqs).toEqual([]);
    });

    it('is cached for 60 seconds and rate-limited to 120 a minute', async () => {
      expect((await site()).headers['cache-control']).toBe(
        'public, max-age=60',
      );
      let last = 0;
      for (let i = 0; i < 121; i++) last = (await site()).status;
      expect(last).toBe(429);
    });

    it('gives all seven working days', async () => {
      const { workingHours } = bodyOf<{
        workingHours: { timeZone: string; days: { dayOfWeek: number }[] };
      }>(await site());
      expect(workingHours.timeZone).toBe('Africa/Johannesburg');
      expect(workingHours.days.map((d) => d.dayOfWeek)).toEqual([
        1, 2, 3, 4, 5, 6, 7,
      ]);
    });

    it('writes the policies from the settings, so they always match', async () => {
      const lines = async () =>
        bodyOf<{ policies: { text: string[]; depositPercent: string } }>(
          await site(),
        ).policies;
      const standard = await lines();
      expect(standard.text[0]).toBe(
        `A ${Number(standard.depositPercent)}% deposit secures your booking. You'll get banking details by email.`,
      );
      expect(standard.text.at(-1)).toContain('Cancel at least');

      await db
        .updateTable('settings')
        .set({ deposit_refundable: false })
        .where('id', '=', 1)
        .execute();
      expect((await lines()).text.at(-1)).toBe("Deposits aren't refundable.");

      await db
        .updateTable('settings')
        .set({ deposit_percent: '0' })
        .where('id', '=', 1)
        .execute();
      const none = await lines();
      expect(none.text).toHaveLength(1);
      expect(none.text[0]).toContain('Book at least');
    });

    it('returns the About text as plain paragraphs, never as markup', async () => {
      await patchContent({
        aboutText: "Hi, I'm Sam.\n\n<script>alert(1)</script>\n\n  Book now!  ",
      });
      const { content } = bodyOf<{ content: { about: string[] } }>(
        await site(),
      );
      expect(content.about).toEqual([
        "Hi, I'm Sam.",
        '<script>alert(1)</script>',
        'Book now!',
      ]);
    });

    it('shows contact, area and social links once they are set', async () => {
      await patchContent({
        tagline: 'Makeup for every occasion',
        locationType: 'travel',
        locationText: 'Pretoria East and Centurion',
        whatsappNumber: '082 123 4567',
        instagramUrl: 'https://instagram.com/freshstarthome',
      });
      const { content } = bodyOf<{ content: Record<string, unknown> }>(
        await site(),
      );
      expect(content).toMatchObject({
        tagline: 'Makeup for every occasion',
        location: { type: 'travel', text: 'Pretoria East and Centurion' },
        social: {
          whatsapp: {
            number: '+27821234567',
            url: 'https://wa.me/27821234567',
          },
          instagram: 'https://instagram.com/freshstarthome',
          facebook: null,
          tiktok: null,
        },
      });
    });

    it('returns only visible gallery items, testimonials and questions, in display order', async () => {
      const res = await upload([
        await jpeg(40, 30, 1),
        await jpeg(40, 30, 2),
        await jpeg(40, 30, 3),
      ]);
      const [a, b, c] = created(res).map((r) => r.item as GalleryItem);
      await as(http().patch(`/api/admin/gallery/${b.id}`)).send({
        isVisible: false,
      });
      await as(http().put('/api/admin/gallery/order')).send({
        ids: [c.id, b.id, a.id],
      });
      const shown = bodyOf<{ gallery: { id: string }[] }>(await site()).gallery;
      expect(shown.map((g) => g.id)).toEqual([c.id, a.id]);

      const t1 = bodyOf<{ item: { id: string } }>(
        await as(http().post('/api/admin/testimonials')).send({
          clientName: 'Lerato',
          quote: 'Lovely',
        }),
      ).item;
      await as(http().post('/api/admin/testimonials')).send({
        clientName: 'Hidden',
        quote: 'Not shown',
        isVisible: false,
      });
      const f1 = bodyOf<{ item: { id: string } }>(
        await as(http().post('/api/admin/faqs')).send({
          question: 'Do you travel?',
          answer: 'Yes.',
        }),
      ).item;
      await as(http().post('/api/admin/faqs')).send({
        question: 'Hidden?',
        answer: 'Yes.',
        isVisible: false,
      });
      const body = bodyOf<{
        testimonials: { clientName: string }[];
        faqs: { question: string }[];
      }>(await site());
      expect(body.testimonials).toEqual([
        { clientName: 'Lerato', quote: 'Lovely', service: null },
      ]);
      expect(body.faqs).toEqual([
        { question: 'Do you travel?', answer: 'Yes.' },
      ]);
      expect(t1.id).toBeDefined();
      expect(f1.id).toBeDefined();
    });

    it('describes each photo, falling back to the caption and then the business name', async () => {
      const [item] = created(await upload([await jpeg()])).map(
        (r) => r.item as GalleryItem,
      );
      await as(http().patch(`/api/admin/gallery/${item.id}`)).send({
        caption: 'Laundry, September',
      });
      const first = bodyOf<{ gallery: { alt: string; caption: string }[] }>(
        await site(),
      ).gallery[0];
      expect(first).toMatchObject({
        alt: 'Laundry, September',
        caption: 'Laundry, September',
      });
      await as(http().patch(`/api/admin/gallery/${item.id}`)).send({
        altText: 'A bright kitchen',
      });
      expect(
        bodyOf<{ gallery: { alt: string }[] }>(await site()).gallery[0].alt,
      ).toBe('A bright kitchen');
    });
  });

  describe('About, contact and area (#104, A-10)', () => {
    it('saves any subset of the fields and returns everything', async () => {
      const res = await patchContent({ tagline: '  Clean, fresh  ' });
      expect(res.status).toBe(200);
      const { content } = bodyOf<{ content: Content }>(res);
      expect(content).toMatchObject({
        tagline: 'Clean, fresh',
        aboutText: '',
      });
      await patchContent({ aboutText: 'Hello' });
      expect((await getContent()).tagline).toBe('Clean, fresh'); // untouched
    });

    it('turns an empty box into nothing', async () => {
      await patchContent({
        tagline: 'x',
        locationType: 'studio',
        locationText: 'My studio',
      });
      const res = await patchContent({
        tagline: '',
        locationType: null,
        locationText: null,
      });
      expect(bodyOf<{ content: Content }>(res).content).toMatchObject({
        tagline: null,
        locationType: null,
        locationText: null,
      });
    });

    it('stores the WhatsApp number as E.164, and refuses one that is not a number', async () => {
      const ok = await patchContent({ whatsappNumber: '0821234567' });
      expect(bodyOf<{ content: Content }>(ok).content.whatsappNumber).toBe(
        '+27821234567',
      );
      expect((await patchContent({ whatsappNumber: '12' })).status).toBe(400);
      const cleared = await patchContent({ whatsappNumber: null });
      expect(
        bodyOf<{ content: Content }>(cleared).content.whatsappNumber,
      ).toBeNull();
    });

    it.each([
      ['instagramUrl', 'http://instagram.com/x'],
      ['instagramUrl', 'https://evil.com/instagram.com'],
      ['instagramUrl', 'https://instagram.com.evil.com'],
      ['instagramUrl', 'javascript:alert(1)'],
      ['facebookUrl', 'https://instagram.com/x'],
      ['tiktokUrl', 'https://tiktok.com@evil.com'],
      ['instagramUrl', 'instagram.com/x'],
    ])('refuses %s = %s', async (field, value) => {
      const res = await patchContent({ [field]: value });
      expect(res.status).toBe(400);
      expect(errorBody(res).details?.[0].field).toBe(field);
    });

    it('takes https links on each network', async () => {
      const res = await patchContent({
        instagramUrl: 'https://www.instagram.com/freshstarthome',
        facebookUrl: 'https://facebook.com/freshstarthome',
        tiktokUrl: 'https://www.tiktok.com/@freshstarthome',
      });
      expect(res.status).toBe(200);
    });

    it('needs the area type and text together', async () => {
      for (const body of [
        { locationType: 'travel' },
        { locationText: 'Pretoria' },
        { locationType: 'travel', locationText: null },
        { locationType: null, locationText: 'Pretoria' },
        { locationType: 'boat', locationText: 'x' },
      ]) {
        expect((await patchContent(body)).status).toBe(400);
      }
      expect(
        (
          await patchContent({
            locationType: 'travel',
            locationText: 'Pretoria',
          })
        ).status,
      ).toBe(200);
    });

    it.each([
      [{ tagline: 'x'.repeat(121) }],
      [{ aboutText: 'x'.repeat(5001) }],
      [{ locationType: 'travel', locationText: 'x'.repeat(201) }],
      [{ heroImageAlt: 'x'.repeat(251) }],
      [{ unknown: 1 }],
      [{ tagline: 42 }],
    ])('rejects %j', async (body) => {
      const res = await patchContent(body);
      expect(res.status).toBe(400);
      expect(errorBody(res).code).toBe('VALIDATION_FAILED');
    });

    it('allows the longest values', async () => {
      const res = await patchContent({
        tagline: 'x'.repeat(120),
        aboutText: 'x'.repeat(5000),
        locationType: 'studio',
        locationText: 'x'.repeat(200),
      });
      expect(res.status).toBe(200);
    });

    it('will not describe a photo that is not there yet', async () => {
      const res = await patchContent({ heroImageAlt: 'A clean room' });
      expect(res.status).toBe(400);
      expect(errorBody(res).details?.[0].field).toBe('heroImageAlt');
    });
  });

  describe('hero and About photos (#106)', () => {
    it('processes and stores the photo, and serves it from /media', async () => {
      const res = await putImage(
        'hero',
        await jpeg(3000, 2000),
        'hero.jpg',
        'A clean room',
      );
      expect(res.status).toBe(200);
      const { heroImage } = bodyOf<{ content: Content }>(res).content;
      expect(heroImage).toMatchObject({
        altText: 'A clean room',
        width: 1600,
        height: 1067,
        duplicateOf: [],
      });
      expect(heroImage?.large.url).toMatch(/^\/media\/[a-f0-9]{64}\.webp$/);

      const file = await http()
        .get(heroImage?.large.url as string)
        .buffer(true);
      expect(file.status).toBe(200);
      const meta = await sharp(file.body as Buffer).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual([
        'webp',
        1600,
        1067,
      ]);

      const pub = bodyOf<{ content: { heroImage: Record<string, unknown> } }>(
        await site(),
      ).content.heroImage;
      expect(pub.alt).toBe('A clean room');
      expect(pub.thumb).toMatchObject({ width: 480, height: 320 });
    });

    it('replaces the old photo and deletes its files and record', async () => {
      await putImage('hero', await jpeg(100, 100, 1));
      const first = (await getContent()).heroImage as Image;
      await putImage('hero', await jpeg(100, 100, 2));
      const second = (await getContent()).heroImage as Image;
      expect(second.id).not.toBe(first.id);
      expect((await http().get(first.large.url)).status).toBe(404);
      expect((await http().get(second.large.url)).status).toBe(200);
      expect(
        await db
          .selectFrom('images')
          .select('id')
          .where('id', '=', first.id)
          .execute(),
      ).toHaveLength(0);
      expect(await storage.list('public')).toHaveLength(2); // one photo: large and thumbnail
    });

    it('keeps the hero and About photos apart', async () => {
      await putImage('hero', await jpeg(100, 100, 1));
      await putImage('about', await jpeg(100, 100, 2));
      const content = await getContent();
      expect(content.heroImage?.id).not.toBe(content.aboutImage?.id);
      await as(http().delete('/api/admin/site-content/images/hero'));
      const after = await getContent();
      expect(after.heroImage).toBeNull();
      expect(after.aboutImage).not.toBeNull();
    });

    it('removes a photo and its files', async () => {
      await putImage('about', await jpeg());
      const del = await as(
        http().delete('/api/admin/site-content/images/about'),
      );
      expect(del.status).toBe(204);
      expect((await getContent()).aboutImage).toBeNull();
      expect(await storage.list('public')).toHaveLength(0);
      // Removing a photo that is not there is fine
      expect(
        (await as(http().delete('/api/admin/site-content/images/about')))
          .status,
      ).toBe(204);
    });

    it('describes a photo through the content', async () => {
      await putImage('hero', await jpeg());
      const res = await patchContent({ heroImageAlt: 'Bright kitchen' });
      expect(bodyOf<{ content: Content }>(res).content.heroImage?.altText).toBe(
        'Bright kitchen',
      );
    });

    it('answers 404 for another slot', async () => {
      expect((await putImage('footer', await jpeg())).status).toBe(404);
      expect(
        (await as(http().delete('/api/admin/site-content/images/footer')))
          .status,
      ).toBe(404);
    });

    it('refuses what is not a JPEG, PNG or WebP by its content, and keeps the old photo', async () => {
      await putImage('hero', await jpeg(100, 100, 1));
      const before = (await getContent()).heroImage as Image;
      for (const bad of [
        Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        ),
        Buffer.from('GIF89a\x01\x00\x01\x00'),
        Buffer.from('%PDF-1.4 not a photo'),
        Buffer.from('plain text'),
      ]) {
        const res = await putImage('hero', bad, 'photo.jpg');
        expect(res.status).toBe(415);
        expect(errorBody(res).code).toBe('UNSUPPORTED_FILE_TYPE');
      }
      expect(((await getContent()).heroImage as Image).id).toBe(before.id);
      expect(await storage.list('public')).toHaveLength(2);
    });

    it('refuses a damaged photo, an empty one and a missing one', async () => {
      const damaged = Buffer.concat([
        Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
        Buffer.from('not a jpeg'),
      ]);
      expect((await putImage('hero', damaged)).status).toBe(400);
      expect((await putImage('hero', Buffer.alloc(0))).status).toBe(400);
      const none = await as(
        http().put('/api/admin/site-content/images/hero'),
      ).send({});
      expect(none.status).toBe(400);
      expect(errorBody(none).code).toBe('FILE_MISSING');
      expect(await storage.list('public')).toHaveLength(0);
    });

    it('refuses a file over 15 MB and an image over 50 megapixels', async () => {
      const big = Buffer.concat([
        Buffer.from([0xff, 0xd8, 0xff]),
        Buffer.alloc(15 * 1024 * 1024 + 1),
      ]);
      const tooBig = await putImage('hero', big);
      expect(tooBig.status).toBe(413);
      expect(errorBody(tooBig).code).toBe('FILE_TOO_LARGE');

      const huge = await sharp({
        create: {
          width: 8000,
          height: 6500,
          channels: 3,
          background: '#ffffff',
        },
      })
        .png({ compressionLevel: 9 })
        .toBuffer();
      const res = await putImage('hero', huge);
      expect(res.status).toBe(400);
      expect(errorBody(res).code).toBe('IMAGE_TOO_LARGE');
      expect(await storage.list('public')).toHaveLength(0);
    });

    it('strips location, camera and date information from what is served', async () => {
      const tagged = await sharp({
        create: { width: 300, height: 200, channels: 3, background: '#336699' },
      })
        .jpeg()
        .withExif({
          IFD0: { Make: 'SecretCameraMaker' },
          IFD3: { GPSLatitudeRef: 'S', GPSLatitude: '25/1 45/1 0/1' },
        })
        .toBuffer();
      expect(tagged.includes(Buffer.from('SecretCameraMaker'))).toBe(true);
      await putImage('hero', tagged);
      const hero = (await getContent()).heroImage as Image;
      for (const url of [hero.large.url, hero.thumb.url]) {
        const data = (await http().get(url).buffer(true)).body as Buffer;
        expect(data.includes(Buffer.from('SecretCameraMaker'))).toBe(false);
        const meta = await sharp(data).metadata();
        expect(meta.exif).toBeUndefined();
      }
    });

    it('points out a photo that is already in the gallery', async () => {
      const same = await jpeg(100, 100, 5);
      const [item] = created(await upload([same])).map(
        (r) => r.item as GalleryItem,
      );
      await putImage('hero', same);
      expect(((await getContent()).heroImage as Image).duplicateOf).toEqual([
        item.id,
      ]);
      expect((await gallery()).items[0].image.duplicateOf).toEqual([]);
    });
  });

  describe('GET /media/:key (#106)', () => {
    it('serves large and thumbnail with long caching and nosniff', async () => {
      await putImage('hero', await jpeg(2000, 1000));
      const hero = (await getContent()).heroImage as Image;
      for (const url of [hero.large.url, hero.thumb.url]) {
        const res = await http().get(url).buffer(true);
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toBe('image/webp');
        expect(res.headers['cache-control']).toBe(
          'public, max-age=31536000, immutable',
        );
        expect(res.headers['x-content-type-options']).toBe('nosniff');
      }
    });

    it('answers 404 for anything that is not a stored photo', async () => {
      const proofKey = newStorageKey();
      await storage.save(
        'private',
        proofKey,
        Buffer.from('%PDF-1.4 secret proof'),
      );
      const stray = newStorageKey();
      await storage.save('public', stray, Buffer.from('a file with no record'));
      for (const path of [
        `/media/${randomBytes(32).toString('hex')}.webp`,
        `/media/${proofKey}.webp`, // a proof's key: private area, never served
        `/media/${stray}.webp`, // in storage but not in the images table
        `/media/${proofKey}`,
        '/media/..%2F..%2Fpackage.json',
        '/media/',
        '/media/UPPERCASE.webp',
        '/media/abc.webp',
        '/media/x.webp',
      ]) {
        const res = await http().get(path);
        expect(res.status, path).toBe(404);
      }
    });

    it('stops serving a deleted photo', async () => {
      await putImage('about', await jpeg());
      const about = (await getContent()).aboutImage as Image;
      expect((await http().get(about.large.url)).status).toBe(200);
      await as(http().delete('/api/admin/site-content/images/about'));
      expect((await http().get(about.large.url)).status).toBe(404);
    });

    it('is not under /api', async () => {
      await putImage('hero', await jpeg());
      const hero = (await getContent()).heroImage as Image;
      expect((await http().get(`/api${hero.large.url}`)).status).toBe(404);
    });
  });

  describe('gallery (#107)', () => {
    it('adds photos, in order, with who confirmed the right to show them', async () => {
      const res = await upload([await jpeg(40, 30, 1), await jpeg(60, 80, 2)], {
        consent: true,
        serviceId: service.id,
      });
      expect(res.status).toBe(201);
      const results = created(res);
      expect(results.map((r) => r.status)).toEqual(['created', 'created']);
      expect(results.map((r) => r.filename)).toEqual([
        'photo0.jpg',
        'photo1.jpg',
      ]);
      const items = results.map((r) => r.item as GalleryItem);
      expect(items.map((i) => i.position)).toEqual([0, 1]);
      expect(items[0]).toMatchObject({
        isVisible: true,
        caption: null,
        service: { id: service.id, name: `${PREFIX}Laundry` },
        consentConfirmedBy: { email: admin.email },
      });
      expect(items[1].image).toMatchObject({ width: 60, height: 80 });
      const list = await gallery();
      expect(list).toMatchObject({ count: 2, limit: 200 });
      expect(list.items.map((i) => i.id)).toEqual(items.map((i) => i.id));
      // Added at the end each time
      const more = created(await upload([await jpeg(10, 10, 3)])).map(
        (r) => r.item as GalleryItem,
      );
      expect(more[0].position).toBe(2);
    });

    it('is refused without the consent confirmation, and stores nothing', async () => {
      const res = await upload([await jpeg()], { consent: false });
      expect(res.status).toBe(400);
      expect(errorBody(res).code).toBe('CONSENT_REQUIRED');
      expect((await gallery()).count).toBe(0);
      expect(await storage.list('public')).toHaveLength(0);
      const wrong = await as(http().post('/api/admin/gallery'))
        .attach('files', await jpeg(), { filename: 'a.jpg' })
        .field('consent', 'yes');
      expect(errorBody(wrong).code).toBe('CONSENT_REQUIRED');
    });

    it('takes 1 to 10 photos in a request', async () => {
      const none = await as(http().post('/api/admin/gallery')).field(
        'consent',
        'true',
      );
      expect(none.status).toBe(400);
      expect(errorBody(none).code).toBe('FILE_MISSING');
      const eleven = await upload(
        await Promise.all(Array.from({ length: 11 }, (_, i) => jpeg(8, 8, i))),
      );
      expect(eleven.status).toBe(400);
      expect(errorBody(eleven).code).toBe('FILE_MISSING');
      expect((await gallery()).count).toBe(0);
      const ten = await upload(
        await Promise.all(Array.from({ length: 10 }, (_, i) => jpeg(8, 8, i))),
      );
      expect(ten.status).toBe(201);
      expect((await gallery()).count).toBe(10);
    });

    it('handles each photo on its own: one bad file does not stop the others', async () => {
      const huge = await sharp({
        create: {
          width: 8000,
          height: 6500,
          channels: 3,
          background: '#ffffff',
        },
      })
        .png({ compressionLevel: 9 })
        .toBuffer();
      const res = await upload([
        await jpeg(20, 20, 1),
        Buffer.from('not a photo'),
        huge,
        await jpeg(20, 20, 2),
      ]);
      expect(res.status).toBe(201);
      const results = created(res);
      expect(results.map((r) => r.status)).toEqual([
        'created',
        'failed',
        'failed',
        'created',
      ]);
      expect(results[1].error?.code).toBe('UNSUPPORTED_FILE_TYPE');
      expect(results[2].error?.code).toBe('IMAGE_TOO_LARGE');
      expect((await gallery()).items.map((i) => i.position)).toEqual([0, 1]);
      expect(await storage.list('public')).toHaveLength(4); // two photos, two sizes each
    });

    it('refuses a service that does not exist', async () => {
      const res = await upload([await jpeg()], {
        consent: true,
        serviceId: '00000000-0000-0000-0000-000000000000',
      });
      expect(res.status).toBe(400);
      expect(errorBody(res).details?.[0].field).toBe('serviceId');
      const bad = await upload([await jpeg()], {
        consent: true,
        serviceId: 'nope',
      });
      expect(bad.status).toBe(400);
      expect((await gallery()).count).toBe(0);
    });

    it('refuses to go over 200 photos', async () => {
      // 199 photos made directly, to be quick
      const uploader = admin.id;
      const rows = Array.from({ length: 199 }, (_, i) => ({
        large_key: newStorageKey(),
        thumb_key: newStorageKey(),
        width: 10,
        height: 10,
        large_bytes: 10,
        thumb_bytes: 10,
        sha256: createHash('sha256').update(`filler ${i}`).digest(),
        uploaded_by: uploader,
      }));
      const images = await db
        .insertInto('images')
        .values(rows)
        .returning('id')
        .execute();
      await db
        .insertInto('gallery_items')
        .values(
          images.map((image, i) => ({
            image_id: image.id,
            position: i,
            consent_confirmed_at: new Date(),
            consent_confirmed_by: uploader,
          })),
        )
        .execute();
      const two = await upload([await jpeg(8, 8, 1), await jpeg(8, 8, 2)]);
      expect(two.status).toBe(409);
      expect(errorBody(two).code).toBe('GALLERY_FULL');
      expect((await gallery()).count).toBe(199);
      expect((await upload([await jpeg(8, 8, 3)])).status).toBe(201);
      expect((await gallery()).count).toBe(200);
      const full = await upload([await jpeg(8, 8, 4)]);
      expect(full.status).toBe(409);
    });

    it('allows 60 photos an hour, then 429', async () => {
      for (let i = 0; i < 6; i++) {
        const res = await upload(
          await Promise.all(
            Array.from({ length: 10 }, (_, j) => jpeg(8, 8, i * 10 + j)),
          ),
        );
        expect(res.status).toBe(201);
      }
      const seventh = await upload([await jpeg(8, 8, 99)]);
      expect(seventh.status).toBe(429);
      expect(seventh.headers['retry-after']).toBeDefined();
      expect((await gallery()).count).toBe(60);
    });

    it('edits the caption, description, service and visibility', async () => {
      const [item] = created(await upload([await jpeg()])).map(
        (r) => r.item as GalleryItem,
      );
      const res = await as(http().patch(`/api/admin/gallery/${item.id}`)).send({
        caption: '  Laundry, September  ',
        altText: 'A clean room',
        serviceId: service.id,
        isVisible: false,
      });
      expect(res.status).toBe(200);
      expect(bodyOf<{ item: GalleryItem }>(res).item).toMatchObject({
        caption: 'Laundry, September',
        isVisible: false,
        service: { id: service.id },
        image: { altText: 'A clean room' },
      });
      const cleared = await as(
        http().patch(`/api/admin/gallery/${item.id}`),
      ).send({
        caption: null,
        serviceId: null,
      });
      expect(bodyOf<{ item: GalleryItem }>(cleared).item).toMatchObject({
        caption: null,
        service: null,
      });
    });

    it.each([
      [{ caption: 'x'.repeat(201) }],
      [{ altText: 'x'.repeat(251) }],
      [{ serviceId: 'nope' }],
      [{ isVisible: 'yes' }],
      [{ other: 1 }],
    ])('rejects %j', async (body) => {
      const [item] = created(await upload([await jpeg()])).map(
        (r) => r.item as GalleryItem,
      );
      expect(
        (await as(http().patch(`/api/admin/gallery/${item.id}`)).send(body))
          .status,
      ).toBe(400);
    });

    it('deletes the item, its photo and both files', async () => {
      const [item] = created(await upload([await jpeg()])).map(
        (r) => r.item as GalleryItem,
      );
      const url = item.image.large.url;
      const del = await as(http().delete(`/api/admin/gallery/${item.id}`));
      expect(del.status).toBe(204);
      expect((await gallery()).count).toBe(0);
      expect(await storage.list('public')).toHaveLength(0);
      expect((await http().get(url)).status).toBe(404);
      expect(
        await db
          .selectFrom('images')
          .select('id')
          .where('id', '=', item.image.id)
          .execute(),
      ).toHaveLength(0);
    });

    it('answers 404 for an unknown item', async () => {
      for (const id of ['00000000-0000-0000-0000-000000000000', 'nope']) {
        expect(
          (await as(http().patch(`/api/admin/gallery/${id}`)).send({})).status,
        ).toBe(404);
        expect(
          (await as(http().delete(`/api/admin/gallery/${id}`))).status,
        ).toBe(404);
      }
    });

    it('sets the display order, and refuses a list that is not every item once', async () => {
      const items = created(
        await upload([
          await jpeg(8, 8, 1),
          await jpeg(8, 8, 2),
          await jpeg(8, 8, 3),
        ]),
      ).map((r) => (r.item as GalleryItem).id);
      const [a, b, c] = items;
      const ok = await as(http().put('/api/admin/gallery/order')).send({
        ids: [c, a, b],
      });
      expect(ok.status).toBe(200);
      expect(
        bodyOf<{ items: GalleryItem[] }>(ok).items.map((i) => i.id),
      ).toEqual([c, a, b]);
      expect((await gallery()).items.map((i) => i.position)).toEqual([0, 1, 2]);
      for (const ids of [
        [a, b],
        [a, b, c, c],
        [a, a, b],
        [a, b, '00000000-0000-0000-0000-000000000000'],
        [],
      ]) {
        const res = await as(http().put('/api/admin/gallery/order')).send({
          ids,
        });
        expect(res.status).toBe(400);
        expect(errorBody(res).code).toBe('VALIDATION_FAILED');
      }
      expect(
        (await as(http().put('/api/admin/gallery/order')).send({})).status,
      ).toBe(400);
      expect((await gallery()).items.map((i) => i.id)).toEqual([c, a, b]);
    });
  });

  describe('testimonials and FAQ (#107, A-10)', () => {
    it('adds, edits, hides, reorders and deletes testimonials', async () => {
      const post = (clientName: string, extra: object = {}) =>
        as(http().post('/api/admin/testimonials')).send({
          clientName,
          quote: `${clientName} loved it`,
          ...extra,
        });
      const a = bodyOf<{
        item: {
          id: string;
          position: number;
          isVisible: boolean;
          service: null;
        };
      }>(await post('Lerato')).item;
      const b = bodyOf<{
        item: { id: string; position: number; service: { name: string } };
      }>(await post('Naledi', { serviceId: service.id })).item;
      expect([a.position, b.position]).toEqual([0, 1]);
      expect(a).toMatchObject({ isVisible: true, service: null });
      expect(b.service.name).toBe(`${PREFIX}Laundry`);

      const edit = await as(
        http().patch(`/api/admin/testimonials/${a.id}`),
      ).send({
        quote: '  Even better  ',
        isVisible: false,
        serviceId: service.id,
      });
      expect(
        bodyOf<{ item: Record<string, unknown> }>(edit).item,
      ).toMatchObject({
        quote: 'Even better',
        isVisible: false,
      });
      const order = await as(http().put('/api/admin/testimonials/order')).send({
        ids: [b.id, a.id],
      });
      expect(
        bodyOf<{ items: { id: string }[] }>(order).items.map((i) => i.id),
      ).toEqual([b.id, a.id]);
      const list = await as(http().get('/api/admin/testimonials'));
      expect(bodyOf<{ items: { id: string }[] }>(list).items).toHaveLength(2);
      expect(
        (await as(http().delete(`/api/admin/testimonials/${a.id}`))).status,
      ).toBe(204);
      expect(
        bodyOf<{ items: unknown[] }>(
          await as(http().get('/api/admin/testimonials')),
        ).items,
      ).toHaveLength(1);
    });

    it('checks testimonial fields and orders', async () => {
      const post = (body: object) =>
        as(http().post('/api/admin/testimonials')).send(body);
      for (const body of [
        {},
        { clientName: '', quote: 'x' },
        { clientName: 'x'.repeat(61), quote: 'x' },
        { clientName: 'A', quote: '' },
        { clientName: 'A', quote: 'x'.repeat(501) },
        { clientName: 'A', quote: 'x', serviceId: 'nope' },
        {
          clientName: 'A',
          quote: 'x',
          serviceId: '00000000-0000-0000-0000-000000000000',
        },
        { clientName: 'A', quote: 'x', other: 1 },
      ]) {
        expect((await post(body)).status).toBe(400);
      }
      expect(
        (await post({ clientName: 'x'.repeat(60), quote: 'x'.repeat(500) }))
          .status,
      ).toBe(201);
      const only = bodyOf<{ items: { id: string }[] }>(
        await as(http().get('/api/admin/testimonials')),
      ).items;
      const dupe = await as(http().put('/api/admin/testimonials/order')).send({
        ids: [only[0].id, only[0].id],
      });
      expect(dupe.status).toBe(400);
      expect(
        (await as(http().patch('/api/admin/testimonials/nope')).send({}))
          .status,
      ).toBe(404);
      expect(
        (
          await as(
            http().delete(
              '/api/admin/testimonials/00000000-0000-0000-0000-000000000000',
            ),
          )
        ).status,
      ).toBe(404);
    });

    it('adds, edits, reorders and deletes questions', async () => {
      const post = (question: string, extra: object = {}) =>
        as(http().post('/api/admin/faqs')).send({
          question,
          answer: `${question} yes`,
          ...extra,
        });
      const a = bodyOf<{ item: { id: string; position: number } }>(
        await post('Do you travel?'),
      ).item;
      const b = bodyOf<{ item: { id: string; position: number } }>(
        await post('How long?'),
      ).item;
      expect([a.position, b.position]).toEqual([0, 1]);
      const edit = await as(http().patch(`/api/admin/faqs/${a.id}`)).send({
        answer: ' Within Pretoria ',
        isVisible: false,
      });
      expect(
        bodyOf<{ item: Record<string, unknown> }>(edit).item,
      ).toMatchObject({
        answer: 'Within Pretoria',
        isVisible: false,
      });
      const order = await as(http().put('/api/admin/faqs/order')).send({
        ids: [b.id, a.id],
      });
      expect(
        bodyOf<{ items: { id: string }[] }>(order).items.map((i) => i.id),
      ).toEqual([b.id, a.id]);
      for (const body of [
        {},
        { question: '', answer: 'x' },
        { question: 'x'.repeat(201), answer: 'x' },
        { question: 'x', answer: '' },
        { question: 'x', answer: 'x'.repeat(2001) },
        { question: 'x', answer: 'y', other: 1 },
      ]) {
        expect(
          (await as(http().post('/api/admin/faqs')).send(body)).status,
        ).toBe(400);
      }
      expect((await as(http().delete(`/api/admin/faqs/${b.id}`))).status).toBe(
        204,
      );
      expect((await as(http().delete(`/api/admin/faqs/${b.id}`))).status).toBe(
        404,
      );
    });

    it('keeps text as text: markup is stored and returned unchanged', async () => {
      await as(http().post('/api/admin/faqs')).send({
        question: '<b>Q</b>',
        answer: '<img src=x onerror=alert(1)>',
      });
      const faq = bodyOf<{ faqs: { question: string; answer: string }[] }>(
        await site(),
      ).faqs[0];
      expect(faq).toEqual({
        question: '<b>Q</b>',
        answer: '<img src=x onerror=alert(1)>',
      });
    });

    it('lets a deleted service leave its testimonials and photos, untagged', async () => {
      const extra = await db
        .insertInto('services')
        .values({
          name: `${PREFIX}Extra`,
          price: '100.00',
          duration_minutes: 30,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await as(http().post('/api/admin/testimonials')).send({
        clientName: 'A',
        quote: 'x',
        serviceId: extra.id,
      });
      const [item] = created(
        await upload([await jpeg()], { consent: true, serviceId: extra.id }),
      ).map((r) => r.item as GalleryItem);
      await db.deleteFrom('services').where('id', '=', extra.id).execute();
      const t = bodyOf<{ items: { service: unknown }[] }>(
        await as(http().get('/api/admin/testimonials')),
      ).items[0];
      expect(t.service).toBeNull();
      expect(
        (await gallery()).items.find((i) => i.id === item.id)?.service,
      ).toBeNull();
    });
  });
});

async function resetContent(db: Kysely<DB>) {
  await db.deleteFrom('gallery_items').execute();
  await db
    .updateTable('site_content')
    .set({
      tagline: null,
      about_text: '',
      hero_image_id: null,
      about_image_id: null,
      location_type: null,
      location_text: null,
      whatsapp_number: null,
      instagram_url: null,
      facebook_url: null,
      tiktok_url: null,
    })
    .execute();
  await db.deleteFrom('images').execute();
  await db.deleteFrom('testimonials').execute();
  await db.deleteFrom('faqs').execute();
}
