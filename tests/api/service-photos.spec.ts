import sharp from 'sharp';
import { startHarness, type Harness } from '../helpers/harness.js';

// The picture on a service's card: the owner uploads it, clients see it in the
// services list, and replacing, removing or deleting the service cleans up the
// files.

const png = (width = 1200, height = 800, r = 200) =>
  sharp({
    create: { width, height, channels: 3, background: { r, g: 80, b: 120 } },
  })
    .png()
    .toBuffer();

describe('Service pictures', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness('svcphoto');
  });
  beforeEach(async () => {
    await h.reset();
    await h.db
      .updateTable('services')
      .set({ image_id: null })
      .where('id', '=', h.service.id)
      .execute();
    await h.db.deleteFrom('images').execute();
  });
  afterAll(() => h.close());

  const upload = async (
    file: Buffer,
    fields: Record<string, string> = {},
    id = h.service.id,
    name = 'photo.png',
  ) => {
    let req = h.asAdmin(h.http().put(`/api/admin/services/${id}/image`));
    for (const [key, value] of Object.entries(fields))
      req = req.field(key, value);
    return req.attach('file', file, { filename: name });
  };
  const publicFiles = () => h.storage.list('public');
  const mine = async () =>
    (await h.http().get('/api/services')).body.services.find(
      (s: { id: string }) => s.id === h.service.id,
    );

  it('has no picture to begin with', async () => {
    expect((await mine()).image).toBeNull();
    const admin = await h.asAdmin(h.http().get('/api/admin/services'));
    expect(
      admin.body.services.find((s: { id: string }) => s.id === h.service.id)
        .image,
    ).toBeNull();
  });

  describe('uploading', () => {
    it('saves a processed picture and shows it to the owner and to clients', async () => {
      const res = await upload(await png(), { altText: 'A soft glam look' });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body.service.image).toMatchObject({
        altText: 'A soft glam look',
        width: 1200,
        height: 800,
      });
      expect(res.body.service.image.thumb.url).toMatch(
        /^\/media\/[0-9a-f]{64}\.webp$/,
      );

      const publicService = await mine();
      expect(publicService.image).toMatchObject({
        alt: 'A soft glam look',
        thumb: {
          url: res.body.service.image.thumb.url,
          width: 480,
          height: 320,
        },
      });
      // Clients can fetch it: a WebP, not the upload
      const file = await h.http().get(publicService.image.large.url);
      expect(file.status).toBe(200);
      expect(file.headers['content-type']).toBe('image/webp');
      expect(await publicFiles()).toHaveLength(2);
    });

    it('describes the picture by the service name when no description is given', async () => {
      await upload(await png());
      expect((await mine()).image.alt).toBe('svcphoto Soft Glam');
    });

    it('replaces the old picture and deletes its files', async () => {
      const first = await upload(await png(1200, 800, 10));
      const second = await upload(await png(800, 800, 220));
      expect(second.status).toBe(200);
      expect(second.body.service.image.id).not.toBe(
        first.body.service.image.id,
      );
      expect(await publicFiles()).toHaveLength(2);
      expect(
        (await h.http().get(first.body.service.image.large.url)).status,
      ).toBe(404);
    });

    it('refuses what is not a picture, whatever its name says', async () => {
      const res = await upload(
        Buffer.from('not a picture at all'),
        {},
        h.service.id,
        'x.png',
      );
      expect(res.status).toBe(415);
      expect(res.body.code).toBe('UNSUPPORTED_FILE_TYPE');
      expect((await mine()).image).toBeNull();
      expect(await publicFiles()).toHaveLength(0);
    });

    it('refuses a request with no file', async () => {
      const res = await h
        .asAdmin(h.http().put(`/api/admin/services/${h.service.id}/image`))
        .field('altText', 'nothing here');
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('FILE_MISSING');
    });

    it('is for signed-in owners only', async () => {
      const res = await h
        .http()
        .put(`/api/admin/services/${h.service.id}/image`)
        .attach('file', await png(), { filename: 'p.png' });
      expect(res.status).toBe(401);
      expect(await publicFiles()).toHaveLength(0);
    });

    it('answers 404 for a service that does not exist', async () => {
      for (const id of ['00000000-0000-4000-8000-000000000000', 'nope']) {
        expect((await upload(await png(), {}, id)).status).toBe(404);
      }
      expect(await publicFiles()).toHaveLength(0);
    });
  });

  describe('removing', () => {
    it('empties the card and deletes the files', async () => {
      await upload(await png());
      const res = await h.asAdmin(
        h.http().delete(`/api/admin/services/${h.service.id}/image`),
      );
      expect(res.status).toBe(204);
      expect((await mine()).image).toBeNull();
      expect(await publicFiles()).toHaveLength(0);
    });

    it('is fine when there was no picture', async () => {
      const res = await h.asAdmin(
        h.http().delete(`/api/admin/services/${h.service.id}/image`),
      );
      expect(res.status).toBe(204);
    });

    it('is for signed-in owners only', async () => {
      await upload(await png());
      const res = await h
        .http()
        .delete(`/api/admin/services/${h.service.id}/image`);
      expect(res.status).toBe(401);
      expect((await mine()).image).not.toBeNull();
    });
  });

  describe('deleting the service', () => {
    it('deletes its picture too', async () => {
      const created = await h.asAdmin(
        h.http().post('/api/admin/services').send({
          name: 'svcphoto Temporary',
          price: '100.00',
          durationMinutes: 30,
        }),
      );
      const id = created.body.service.id as string;
      expect((await upload(await png(), {}, id)).status).toBe(200);
      expect(await publicFiles()).toHaveLength(2);
      const res = await h.asAdmin(h.http().delete(`/api/admin/services/${id}`));
      expect(res.status).toBe(204);
      expect(await publicFiles()).toHaveLength(0);
      expect(await h.db.selectFrom('images').select('id').execute()).toEqual(
        [],
      );
    });

    it('keeps the picture of a service that was only deactivated because it has bookings', async () => {
      await upload(await png());
      await h.makeBooking();
      const res = await h.asAdmin(
        h.http().delete(`/api/admin/services/${h.service.id}`),
      );
      expect(res.body.deactivated).toBe(true);
      expect(res.body.service.image).not.toBeNull();
      expect(await publicFiles()).toHaveLength(2);
      await h.asAdmin(
        h
          .http()
          .patch(`/api/admin/services/${h.service.id}`)
          .send({ isActive: true }),
      );
    });
  });
});
