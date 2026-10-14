import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { createApp } from '../../src/app.factory.js';

// The public website is served from public/ alongside the API (#23).
describe('Public website', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createApp<INestApplication<App>>({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves the home page with the shared layout', async () => {
    const res = await request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Content-Type', /html/);
    expect(res.text).toContain('<site-header');
    expect(res.text).toContain('<site-footer');
    expect(res.text).toContain('<main id="main">');
    expect(res.text).toContain('bootstrap@5.3.3/dist/css/bootstrap.min.css');
    expect(res.text).toContain('bootstrap-icons@1.11.3');
    expect(res.text).toContain('/css/tokens.css');
  });

  it.each([
    ['/css/tokens.css', /css/],
    ['/css/site.css', /css/],
    ['/js/layout.js', /javascript/],
    ['/images/logo/logo-horizontal.png', /png/],
  ])('serves %s', async (path, type) => {
    await request(app.getHttpServer())
      .get(path)
      .expect(200)
      .expect('Content-Type', type);
  });

  it('serves the public services page, loading its data from the API (#32)', async () => {
    const res = await request(app.getHttpServer())
      .get('/services.html')
      .expect(200)
      .expect('Content-Type', /html/);
    expect(res.text).toContain('<site-header current="services">');
    expect(res.text).toContain('/js/services-page.js');
    // The page holds no service data itself.
    expect(res.text).not.toContain('Soft Glam');
  });

  it.each([
    '/admin/login.html',
    '/admin/',
    '/admin/services.html',
    '/admin/availability.html',
    '/admin/bookings.html',
    '/admin/booking.html',
    '/admin/settings.html',
    '/admin/calendar.html',
    '/admin/website.html',
  ])(
    'serves the portal page %s, which is kept out of search engines',
    async (path) => {
      const res = await request(app.getHttpServer())
        .get(path)
        .expect(200)
        .expect('Content-Type', /html/);
      expect(res.text).toContain('<meta name="robots" content="noindex"');
    },
  );

  it.each([
    ['/js/format.js', /javascript/],
    ['/js/services-page.js', /javascript/],
    ['/js/admin-services.js', /javascript/],
    ['/js/time-zone.js', /javascript/],
    ['/js/book-page.js', /javascript/],
    ['/js/admin-availability.js', /javascript/],
    ['/js/phone.js', /javascript/],
    ['/js/book-details-page.js', /javascript/],
    ['/js/booking-confirmation-page.js', /javascript/],
    ['/js/lookup-page.js', /javascript/],
    ['/js/admin-bookings-shared.js', /javascript/],
    ['/js/admin-dashboard.js', /javascript/],
    ['/js/admin-bookings.js', /javascript/],
    ['/js/admin-booking.js', /javascript/],
    ['/js/admin-settings.js', /javascript/],
    ['/js/booking-page.js', /javascript/],
    ['/js/admin-calendar.js', /javascript/],
    ['/js/admin-website.js', /javascript/],
    ['/js/home-page.js', /javascript/],
    ['/js/hours.js', /javascript/],
  ])('serves %s', async (path, type) => {
    await request(app.getHttpServer())
      .get(path)
      .expect(200)
      .expect('Content-Type', type);
  });

  it('serves the date and time picker, which loads its data from the API (#40)', async () => {
    const res = await request(app.getHttpServer())
      .get('/book.html')
      .expect(200)
      .expect('Content-Type', /html/);
    expect(res.text).toContain('/js/book-page.js');
    expect(res.text).toContain('Choose a date and time');
  });

  it.each([
    ['/book-details.html', 'Your details'],
    ['/booking-confirmation.html', 'What happens next'],
    ['/lookup.html', 'Find my booking'],
  ])('serves the booking page %s (#51, #52)', async (path, heading) => {
    const res = await request(app.getHttpServer())
      .get(path)
      .expect(200)
      .expect('Content-Type', /html/);
    expect(res.text).toContain(heading);
    // Pages with a booking in them are kept out of search engines
    expect(res.text).toContain('<meta name="robots" content="noindex"');
  });

  it('keeps the reference and the email out of what these pages send to other sites', async () => {
    for (const path of ['/booking-confirmation.html', '/lookup.html']) {
      const res = await request(app.getHttpServer()).get(path).expect(200);
      expect(res.text).toContain('<meta name="referrer" content="no-referrer"');
    }
  });

  it('does not show the home page for an unknown address', async () => {
    await request(app.getHttpServer()).get('/no-such-page.html').expect(404);
  });

  it('leaves /api to the API', async () => {
    await request(app.getHttpServer())
      .get('/api/does-not-exist')
      .expect(404)
      .expect('Content-Type', /json/);
  });
});
