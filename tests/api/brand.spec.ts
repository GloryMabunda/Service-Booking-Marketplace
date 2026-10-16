import sharp from 'sharp';
import { startHarness, type Harness } from '../helpers/harness.js';

// The business's own brand: its name comes from Settings, its logo is uploaded
// in the portal, every page asks GET /api/brand, and emails are signed with
// the business name.

const png = () =>
  sharp({
    create: {
      width: 600,
      height: 200,
      channels: 4,
      background: { r: 10, g: 120, b: 90, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer();

describe('Brand', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness('brand');
  });
  beforeEach(async () => {
    await h.reset();
    await h.db
      .updateTable('site_content')
      .set({ logo_image_id: null })
      .execute();
    await h.db.deleteFrom('images').execute();
    await h.asAdmin(
      h
        .http()
        .patch('/api/admin/settings')
        .send({ businessName: 'Studio Nine' }),
    );
  });
  afterAll(() => h.close());

  const putLogo = async () =>
    h
      .asAdmin(h.http().put('/api/admin/site-content/images/logo'))
      .attach('file', await png(), { filename: 'logo.png' });

  describe('GET /api/brand', () => {
    it('gives the business name, and no logo until one is uploaded', async () => {
      const res = await h.http().get('/api/brand');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        name: 'Studio Nine',
        tagline: null,
        logo: null,
      });
      expect(res.headers['cache-control']).toBe('public, max-age=60');
    });

    it('follows the name in Settings', async () => {
      await h.asAdmin(
        h
          .http()
          .patch('/api/admin/settings')
          .send({ businessName: 'Lumen Lashes' }),
      );
      expect((await h.http().get('/api/brand')).body.name).toBe('Lumen Lashes');
    });

    it('includes the tagline from the home page content', async () => {
      await h.asAdmin(
        h
          .http()
          .patch('/api/admin/site-content')
          .send({ tagline: 'Beauty, booked.' }),
      );
      expect((await h.http().get('/api/brand')).body.tagline).toBe(
        'Beauty, booked.',
      );
      await h.asAdmin(
        h.http().patch('/api/admin/site-content').send({ tagline: null }),
      );
    });

    it('needs no sign-in and is limited', async () => {
      let last = 0;
      for (let i = 0; i < 121; i++)
        last = (await h.http().get('/api/brand')).status;
      expect(last).toBe(429);
    });
  });

  describe('the logo', () => {
    it('is uploaded in the portal and then shown to everyone', async () => {
      const res = await putLogo();
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.content.logoImage).toMatchObject({
        width: 600,
        height: 200,
      });

      const brand = (await h.http().get('/api/brand')).body;
      expect(brand.logo).toMatchObject({
        alt: 'Studio Nine',
        thumb: { width: 480, height: 160 },
      });
      expect(brand.logo.large.url).toMatch(/^\/media\/[0-9a-f]{64}\.webp$/);
      // The picture is served, with its see-through background kept
      const file = await h.http().get(brand.logo.thumb.url);
      expect(file.status).toBe(200);
      expect(file.headers['content-type']).toBe('image/webp');
      const meta = await sharp(file.body as Buffer).metadata();
      expect(meta.hasAlpha).toBe(true);
    });

    it('also reaches the home page data', async () => {
      await putLogo();
      const site = (await h.http().get('/api/site')).body;
      expect(site.content.logoImage.alt).toBe('Studio Nine');
    });

    it('can be described for people who cannot see it', async () => {
      await putLogo();
      const res = await h.asAdmin(
        h
          .http()
          .patch('/api/admin/site-content')
          .send({ logoImageAlt: 'A teal wordmark' }),
      );
      expect(res.status).toBe(200);
      expect((await h.http().get('/api/brand')).body.logo.alt).toBe(
        'A teal wordmark',
      );
    });

    it('replaces the old logo and deletes its files', async () => {
      const first = await putLogo();
      const second = await putLogo();
      expect(second.body.content.logoImage.id).not.toBe(
        first.body.content.logoImage.id,
      );
      expect((await h.storage.list('public')).length).toBe(2);
      expect(
        (await h.http().get(first.body.content.logoImage.large.url)).status,
      ).toBe(404);
    });

    it('can be removed, which returns the page to the name as text', async () => {
      await putLogo();
      const res = await h.asAdmin(
        h.http().delete('/api/admin/site-content/images/logo'),
      );
      expect(res.status).toBe(204);
      expect((await h.http().get('/api/brand')).body.logo).toBeNull();
      expect(await h.storage.list('public')).toHaveLength(0);
    });

    it('is for signed-in owners only', async () => {
      const res = await h
        .http()
        .put('/api/admin/site-content/images/logo')
        .attach('file', await png(), { filename: 'logo.png' });
      expect(res.status).toBe(401);
      expect((await h.http().get('/api/brand')).body.logo).toBeNull();
    });

    it('refuses what is not a picture', async () => {
      const res = await h
        .asAdmin(h.http().put('/api/admin/site-content/images/logo'))
        .attach('file', Buffer.from('not a picture'), { filename: 'logo.png' });
      expect(res.status).toBe(415);
    });
  });

  describe('emails', () => {
    it('are signed with the business name, never with someone else’s', async () => {
      const { booking } = await h.makeBooking();
      await h.asAdmin(
        h.http().post(`/api/admin/bookings/${booking.id}/booking-link`),
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      const email = h.provider.to(booking.client_email)[0];
      expect(email.text).toContain('See you soon,\nStudio Nine');
      expect(email.html).toContain('See you soon,<br>Studio Nine');
      expect(email.text).not.toContain('See you soon,\nGlory');
      await h.db
        .deleteFrom('notifications')
        .where('booking_id', '=', booking.id)
        .execute();
    });
  });
});
