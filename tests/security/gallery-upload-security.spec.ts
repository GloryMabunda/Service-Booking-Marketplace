import { crc32, deflateSync } from 'node:zlib';
import sharp from 'sharp';
import { startHarness, type Harness } from '../helpers/harness.js';
import { errorBody } from '../helpers/http.js';

// Website photo uploads can't leak personal data or be abused (A-10, section 9,
// #109): metadata is stripped, a file is judged by its content, an enormous
// image is refused without the server running out of memory, permission must
// be confirmed, and only the administrator can add, change or remove photos.

const MB = 1024 * 1024;
const jpeg = (width = 40, height = 30) =>
  sharp({ create: { width, height, channels: 3, background: '#336699' } })
    .jpeg()
    .toBuffer();

// A PNG whose header claims a huge picture but whose file is a few dozen bytes:
// the "pixel bomb" a server falls over on if it decodes before it checks
function pngBomb(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc(64))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// A JPEG whose frame header claims 65,535 x 65,535 pixels (4 gigapixels)
function jpegBomb(): Buffer {
  return Buffer.from([
    0xff,
    0xd8, // start of image
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    0xff,
    0xff,
    0xff,
    0xff,
    0x03, // frame: 8-bit, 65535 x 65535, 3 components
    0x01,
    0x22,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
    0xff,
    0xd9, // end of image
  ]);
}

describe('Gallery upload security', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness('gallsec');
  });
  beforeEach(async () => {
    await h.reset();
    await h.db.deleteFrom('gallery_items').execute();
    await h.db.deleteFrom('images').execute();
  });
  afterAll(() => h.close());

  const upload = (
    files: { data: Buffer; name?: string; type?: string }[],
    fields: Record<string, string> = { consent: 'true' },
  ) => {
    let r = h.asAdmin(h.http().post('/api/admin/gallery'));
    for (const [name, value] of Object.entries(fields))
      r = r.field(name, value);
    for (const [i, f] of files.entries()) {
      r = r.attach('files', f.data, {
        filename: f.name ?? `photo${i}.jpg`,
        contentType: f.type ?? 'image/jpeg',
      });
    }
    return r;
  };
  const counts = async () => ({
    items: Number(
      (
        await h.db
          .selectFrom('gallery_items')
          .select((e) => e.fn.countAll<string>().as('n'))
          .executeTakeFirstOrThrow()
      ).n,
    ),
    images: Number(
      (
        await h.db
          .selectFrom('images')
          .select((e) => e.fn.countAll<string>().as('n'))
          .executeTakeFirstOrThrow()
      ).n,
    ),
    files: (await h.storage.list('public')).length,
  });

  describe('personal data in a photo', () => {
    it('comes out with no GPS, camera or date information', async () => {
      const tagged = await sharp({
        create: { width: 400, height: 300, channels: 3, background: '#aa3366' },
      })
        .jpeg()
        .withExif({
          IFD0: {
            Make: 'SecretCameraMaker',
            Model: 'PrivateModel 9',
            Copyright: 'Someone Private',
            Artist: 'Glory Real Name',
          },
          IFD3: {
            GPSLatitudeRef: 'S',
            GPSLatitude: '25/1 45/1 0/1',
            GPSLongitudeRef: 'E',
            GPSLongitude: '28/1 12/1 0/1',
          },
        })
        .withIccProfile('p3')
        .toBuffer();
      // The test photo really does carry the data
      for (const secret of [
        'SecretCameraMaker',
        'PrivateModel',
        'Glory Real Name',
      ]) {
        expect(tagged.includes(Buffer.from(secret))).toBe(true);
      }

      const res = await upload([{ data: tagged }]);
      expect(res.status).toBe(201);
      const item = res.body.results[0].item;
      for (const url of [item.image.large.url, item.image.thumb.url]) {
        const served = (await h.http().get(url).buffer(true)).body as Buffer;
        for (const secret of [
          'SecretCameraMaker',
          'PrivateModel',
          'Glory Real Name',
          'Someone Private',
          'GPS',
          'Exif',
        ]) {
          expect(
            served.includes(Buffer.from(secret)),
            `${url} holds ${secret}`,
          ).toBe(false);
        }
        const meta = await sharp(served).metadata();
        expect(meta.exif).toBeUndefined();
        expect(meta.icc).toBeUndefined();
        expect(meta.xmp).toBeUndefined();
        expect(meta.orientation).toBeUndefined();
      }
    });

    it('does not keep the original upload anywhere', async () => {
      const original = await jpeg(500, 400);
      await upload([{ data: original }]);
      const keys = await h.storage.list('public');
      expect(keys).toHaveLength(2); // the large and the small version
      for (const key of keys) {
        expect((await h.storage.read('public', key)).equals(original)).toBe(
          false,
        );
      }
      expect(await h.storage.list('private')).toHaveLength(0);
    });

    it('removes metadata from a PNG and a WebP as well', async () => {
      const png = await sharp({
        create: { width: 50, height: 50, channels: 3, background: '#112233' },
      })
        .png()
        .withExif({ IFD0: { Copyright: 'PNGSecretOwner' } })
        .toBuffer();
      const webp = await sharp({
        create: { width: 50, height: 50, channels: 3, background: '#112233' },
      })
        .webp()
        .withExif({ IFD0: { Copyright: 'WEBPSecretOwner' } })
        .toBuffer();
      const res = await upload([
        { data: png, name: 'a.png', type: 'image/png' },
        { data: webp, name: 'b.webp', type: 'image/webp' },
      ]);
      expect(res.body.results.map((r: { status: string }) => r.status)).toEqual(
        ['created', 'created'],
      );
      for (const result of res.body.results) {
        for (const url of [
          result.item.image.large.url,
          result.item.image.thumb.url,
        ]) {
          const served = (await h.http().get(url).buffer(true)).body as Buffer;
          expect(served.includes(Buffer.from('SecretOwner'))).toBe(false);
          expect((await sharp(served).metadata()).exif).toBeUndefined();
        }
      }
    });
  });

  describe('what a file is comes from its content', () => {
    const impostors: [string, Buffer][] = [
      [
        'an SVG with a script',
        Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>',
        ),
      ],
      [
        'an HTML page',
        Buffer.from('<html><body onload="alert(1)">hi</body></html>'),
      ],
      ['a GIF', Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;')],
      ['a PDF', Buffer.from('%PDF-1.4\n%not a photo\n')],
      [
        'a Windows program',
        Buffer.concat([Buffer.from('MZ'), Buffer.alloc(100)]),
      ],
      ['a ZIP', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])],
      ['plain text', Buffer.from('this is not a photo')],
      ['a BMP', Buffer.from('BM\x00\x00\x00\x00\x00\x00\x00\x00')],
    ];

    it.each(impostors)('refuses %s named photo.jpg', async (_name, data) => {
      const res = await upload([
        { data, name: 'photo.jpg', type: 'image/jpeg' },
      ]);
      expect(res.status).toBe(201); // the request is fine; the file is not
      const [result] = res.body.results;
      expect(result.status).toBe('failed');
      expect(result.error.code).toBe('UNSUPPORTED_FILE_TYPE');
      expect(await counts()).toEqual({ items: 0, images: 0, files: 0 });
    });

    it.each([
      [
        'a JPEG signature followed by rubbish',
        Buffer.concat([
          Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
          Buffer.from('not really a jpeg at all'),
        ]),
      ],
      [
        'a PNG signature followed by rubbish',
        Buffer.concat([
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          Buffer.from('rubbish'),
        ]),
      ],
      ['a half-finished WebP', Buffer.from('RIFF\x10\x00\x00\x00WEBPVP8 ')],
    ])('refuses %s', async (_name, data) => {
      const res = await upload([{ data }]);
      expect(res.body.results[0].status).toBe('failed');
      expect(['FILE_INVALID', 'UNSUPPORTED_FILE_TYPE']).toContain(
        res.body.results[0].error.code,
      );
      expect(await counts()).toEqual({ items: 0, images: 0, files: 0 });
    });

    it('refuses them for the hero and About photos as well', async () => {
      for (const [, data] of impostors) {
        const res = await h
          .asAdmin(h.http().put('/api/admin/site-content/images/hero'))
          .attach('file', data, {
            filename: 'hero.jpg',
            contentType: 'image/jpeg',
          });
        expect(res.status).toBe(415);
      }
      expect(await counts()).toEqual({ items: 0, images: 0, files: 0 });
    });

    it('accepts a real photo whatever its name, and serves it only as WebP', async () => {
      const res = await upload([
        { data: await jpeg(), name: 'holiday.txt', type: 'text/plain' },
      ]);
      expect(res.body.results[0].status).toBe('created');
      const url = res.body.results[0].item.image.large.url;
      const served = await h.http().get(url);
      expect(served.headers['content-type']).toBe('image/webp');
      expect(served.headers['x-content-type-options']).toBe('nosniff');
    });
  });

  describe('an enormous image (a pixel bomb)', () => {
    const bombs: [string, Buffer][] = [
      ['a PNG claiming 100,000 x 100,000 pixels', pngBomb(100_000, 100_000)],
      ['a PNG claiming 60,000 x 1,000 pixels', pngBomb(60_000, 1_000)],
      ['a JPEG claiming 65,535 x 65,535 pixels', jpegBomb()],
    ];

    it.each(bombs)(
      'is refused without using up memory: %s',
      async (_name, data) => {
        expect(data.length).toBeLessThan(1024); // a tiny file
        const before = process.memoryUsage().rss;
        const started = Date.now();
        const res = await upload([
          { data, name: 'bomb.png', type: 'image/png' },
        ]);
        const grew = process.memoryUsage().rss - before;
        expect(res.status).toBe(201);
        const [result] = res.body.results;
        expect(result.status).toBe('failed');
        expect(['IMAGE_TOO_LARGE', 'FILE_INVALID']).toContain(
          result.error.code,
        );
        // Decoding 10 gigapixels would need tens of gigabytes
        expect(grew).toBeLessThan(150 * MB);
        expect(Date.now() - started).toBeLessThan(5000);
        expect(await counts()).toEqual({ items: 0, images: 0, files: 0 });
      },
    );

    it('is named for what it is when the header is honest', async () => {
      const res = await upload([
        { data: pngBomb(8000, 8000), name: 'big.png', type: 'image/png' },
      ]);
      expect(res.body.results[0].error.code).toBe('IMAGE_TOO_LARGE');
    });

    it('is refused for the hero photo too', async () => {
      const res = await h
        .asAdmin(h.http().put('/api/admin/site-content/images/about'))
        .attach('file', pngBomb(100_000, 100_000), {
          filename: 'x.png',
          contentType: 'image/png',
        });
      expect(res.status).toBe(400);
      expect(['IMAGE_TOO_LARGE', 'FILE_INVALID']).toContain(
        errorBody(res).code,
      );
    });

    it('lets an honest photo just under 50 megapixels through', async () => {
      const big = await sharp({
        create: {
          width: 7000,
          height: 7000,
          channels: 3,
          background: '#ffffff',
        },
      })
        .png({ compressionLevel: 9 })
        .toBuffer();
      const res = await upload([
        { data: big, name: 'big.png', type: 'image/png' },
      ]);
      expect(res.body.results[0].status).toBe('created');
    });

    it('refuses a file over 15 MB, stopping the upload early', async () => {
      const body = Buffer.concat([
        Buffer.from([0xff, 0xd8, 0xff]),
        Buffer.alloc(40 * MB),
      ]);
      const before = process.memoryUsage().rss;
      const res = await upload([{ data: body }]);
      expect(res.status).toBe(413);
      expect(errorBody(res).code).toBe('FILE_TOO_LARGE');
      expect(process.memoryUsage().rss - before).toBeLessThan(250 * MB);
      expect(await counts()).toEqual({ items: 0, images: 0, files: 0 });
    });

    it('takes no more than 10 photos in one request', async () => {
      const photos = await Promise.all(
        Array.from({ length: 11 }, () => jpeg(8, 8)),
      );
      const res = await upload(photos.map((data) => ({ data })));
      expect(res.status).toBe(400);
      expect(errorBody(res).code).toBe('FILE_MISSING');
      expect(await counts()).toEqual({ items: 0, images: 0, files: 0 });
    });
  });

  describe('permission to show the people in the photos', () => {
    it.each([
      ['missing', {}],
      ['false', { consent: 'false' }],
      ['yes', { consent: 'yes' }],
      ['1', { consent: '1' }],
      ['on', { consent: 'on' }],
      ['empty', { consent: '' }],
    ])('is required: %s is refused', async (_name, fields) => {
      const res = await upload([{ data: await jpeg() }], fields);
      expect(res.status).toBe(400);
      expect(errorBody(res).code).toBe('CONSENT_REQUIRED');
      expect(await counts()).toEqual({ items: 0, images: 0, files: 0 });
    });

    it('is recorded with who confirmed it and when', async () => {
      const res = await upload([{ data: await jpeg() }]);
      const item = res.body.results[0].item;
      expect(item.consentConfirmedBy.email).toBe(h.admin.email);
      expect(Date.now() - Date.parse(item.consentConfirmedAt)).toBeLessThan(
        60_000,
      );
    });
  });

  describe('only the administrator may change the website', () => {
    const attempts = async () => {
      const id = '00000000-0000-0000-0000-000000000000';
      const photo = await jpeg();
      return [
        [
          'upload to the gallery',
          () =>
            h
              .http()
              .post('/api/admin/gallery')
              .field('consent', 'true')
              .attach('files', photo, { filename: 'a.jpg' }),
        ],
        [
          'replace the hero photo',
          () =>
            h
              .http()
              .put('/api/admin/site-content/images/hero')
              .attach('file', photo, { filename: 'a.jpg' }),
        ],
        [
          'remove the About photo',
          () => h.http().delete('/api/admin/site-content/images/about'),
        ],
        [
          'edit a gallery photo',
          () =>
            h
              .http()
              .patch(`/api/admin/gallery/${id}`)
              .send({ caption: 'hacked' }),
        ],
        [
          'delete a gallery photo',
          () => h.http().delete(`/api/admin/gallery/${id}`),
        ],
        [
          'reorder the gallery',
          () => h.http().put('/api/admin/gallery/order').send({ ids: [] }),
        ],
        [
          'change the About text',
          () =>
            h
              .http()
              .patch('/api/admin/site-content')
              .send({ aboutText: 'hacked' }),
        ],
        [
          'add a testimonial',
          () =>
            h
              .http()
              .post('/api/admin/testimonials')
              .send({ clientName: 'x', quote: 'hacked' }),
        ],
        [
          'add a question',
          () =>
            h
              .http()
              .post('/api/admin/faqs')
              .send({ question: 'x', answer: 'hacked' }),
        ],
      ] as const;
    };

    it.each(['no session', 'a made-up session'])(
      'refuses a visitor with %s',
      async (kind) => {
        for (const [name, send] of await attempts()) {
          let r = send();
          if (kind !== 'no session') r = r.set('Cookie', 'mbg_session=forged');
          const res = await r;
          expect(res.status, name).toBe(401);
        }
        expect(await counts()).toEqual({ items: 0, images: 0, files: 0 });
        const site = await h.http().get('/api/site');
        expect(JSON.stringify(site.body)).not.toContain('hacked');
      },
    );

    it('leaves existing photos alone when a visitor tries to delete them', async () => {
      const made = await upload([{ data: await jpeg() }]);
      const item = made.body.results[0].item;
      const before = await counts();
      expect(
        (await h.http().delete(`/api/admin/gallery/${item.id}`)).status,
      ).toBe(401);
      expect(
        (
          await h
            .http()
            .delete(`/api/admin/gallery/${item.id}`)
            .set('Cookie', 'mbg_session=forged')
        ).status,
      ).toBe(401);
      expect(await counts()).toEqual(before);
      expect((await h.http().get(item.image.large.url)).status).toBe(200);
    });

    it('refuses a change that another website started, even with a good session', async () => {
      const res = await upload([{ data: await jpeg() }]).set(
        'Sec-Fetch-Site',
        'cross-site',
      );
      expect(res.status).toBe(403);
      expect(await counts()).toEqual({ items: 0, images: 0, files: 0 });
    });
  });

  describe('/media serves website photos and nothing else', () => {
    it('never serves a proof of payment, even by its key', async () => {
      const booking = await h.makeBooking();
      const PDF = Buffer.from('%PDF-1.4\nsecret proof\n');
      await h
        .http()
        .post(`/api/booking/${booking.token}/proofs`)
        .attach('file', PDF, { filename: 'p.pdf' });
      const [proof] = await h.db
        .selectFrom('payment_proofs')
        .selectAll()
        .execute();
      for (const path of [
        `/media/${proof.storage_key}.webp`,
        `/media/${proof.storage_key}`,
        `/media/${proof.storage_key}.pdf`,
        `/media/../${proof.storage_key}`,
      ]) {
        const res = await h.http().get(path);
        expect(res.status, path).toBe(404);
      }
    });

    it('serves only photos recorded as such', async () => {
      const made = await upload([{ data: await jpeg() }]);
      const item = made.body.results[0].item;
      expect((await h.http().get(item.image.large.url)).status).toBe(200);
      const largeKey = item.image.large.url
        .replace('/media/', '')
        .replace('.webp', '');
      // Take the record away: the file is still on disk, but is no longer served
      await h.db.deleteFrom('gallery_items').execute();
      await h.db.deleteFrom('images').execute();
      expect(await h.storage.list('public')).toContain(largeKey);
      expect((await h.http().get(item.image.large.url)).status).toBe(404);
    });
  });

  it('allows 60 photos an hour, then 429', async () => {
    for (let i = 0; i < 6; i++) {
      const photos = await Promise.all(
        Array.from({ length: 10 }, () => jpeg(8, 8)),
      );
      expect((await upload(photos.map((data) => ({ data })))).status).toBe(201);
    }
    const seventh = await upload([{ data: await jpeg(8, 8) }]);
    expect(seventh.status).toBe(429);
  });
});
