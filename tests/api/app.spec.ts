import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { createApp } from '../../src/app.factory.js';

// Example API test (#21): boots the whole app the way production does, with
// every feature module and the validated configuration, and sends it real
// HTTP requests.
describe('App', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createApp<INestApplication<App>>({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers unknown API routes with a JSON 404', () => {
    return request(app.getHttpServer())
      .get('/api/does-not-exist')
      .expect(404)
      .expect('Content-Type', /json/);
  });
});
