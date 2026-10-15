import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { Test } from '@nestjs/testing';
import { DATABASE } from '../../src/database/database.module.js';
import { HealthController } from '../../src/health/health.controller.js';
import { startHarness, type Harness } from '../helpers/harness.js';

// GET /api/health (#91): ok while the database answers, 503 when it doesn't,
// and nothing else in the answer.

describe('Health check', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness('health');
  });
  afterAll(() => h.close());

  it('says ok, without a sign-in, and is never cached', async () => {
    const res = await h.http().get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  describe('when the database is down', () => {
    let app: INestApplication<App>;
    beforeAll(async () => {
      const failing = {
        // What Kysely's sql tag calls on its executor
        getExecutor: () => ({
          executeQuery: () => Promise.reject(new Error('connection refused')),
        }),
        executeQuery: () => Promise.reject(new Error('connection refused')),
      };
      const moduleRef = await Test.createTestingModule({
        controllers: [HealthController],
        providers: [{ provide: DATABASE, useValue: failing }],
      }).compile();
      app = moduleRef.createNestApplication<INestApplication<App>>({
        logger: false,
      });
      app.setGlobalPrefix('api');
      await app.init();
    });
    afterAll(() => app.close());

    it('answers 503 and gives no reason', async () => {
      const res = await request(app.getHttpServer()).get('/api/health');
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ status: 'unavailable' });
      expect(res.text).not.toContain('refused');
    });
  });
});
