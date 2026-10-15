import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { ApiExceptionFilter } from '../../src/common/api-error.js';
import { RateLimitModule } from '../../src/common/rate-limit.module.js';
import { DATABASE } from '../../src/database/database.module.js';
import { DemoController } from '../../src/demo/demo.controller.js';
import { DemoMailbox } from '../../src/demo/demo-mailbox.js';
import { HealthController } from '../../src/health/health.controller.js';
import { APP_FILTER } from '@nestjs/core';
import type { Kysely } from 'kysely';
import type { DB } from '../../src/database/database.types.js';
import { createTestDatabase } from '../helpers/database.js';

// Demo mode (docs/demo.md): the mailbox endpoint exists only when it is on, and
// the health check says so. Each app here is built by hand with the setting
// switched one way or the other.

async function appWith(demo: boolean) {
  const mailbox = new DemoMailbox();
  const db = createTestDatabase();
  const moduleRef = await Test.createTestingModule({
    imports: [RateLimitModule],
    controllers: [DemoController, HealthController],
    providers: [
      { provide: DemoMailbox, useValue: mailbox },
      { provide: ConfigService, useValue: { get: () => demo } },
      { provide: DATABASE, useValue: db },
      { provide: APP_FILTER, useClass: ApiExceptionFilter },
    ],
  }).compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>({
    logger: false,
  });
  app.setGlobalPrefix('api');
  await app.init();
  return { app, mailbox, db };
}

describe('Demo mode', () => {
  describe('switched on', () => {
    let app: INestApplication<App>;
    let mailbox: DemoMailbox;
    let db: Kysely<DB>;
    beforeAll(async () => {
      ({ app, mailbox, db } = await appWith(true));
    });
    beforeEach(() => mailbox.clear());
    afterAll(async () => {
      await app.close();
      await db.destroy();
    });

    it('lists the emails the demo kept, newest first, never cached', async () => {
      await mailbox.send({
        to: 'a@example.com',
        subject: 'First',
        text: 'one',
        html: '<p>one</p>',
      });
      await mailbox.send({
        to: 'b@example.com',
        subject: 'Second',
        text: 'two http://localhost:3000/booking/abc',
        html: '<p>two</p>',
      });
      const res = await request(app.getHttpServer()).get('/api/demo/emails');
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(
        res.body.emails.map((e: { subject: string }) => e.subject),
      ).toEqual(['Second', 'First']);
      expect(res.body.emails[0]).toMatchObject({
        to: 'b@example.com',
        text: expect.stringContaining('/booking/abc') as string,
      });
      // The HTML copy is not sent to the page
      expect(res.body.emails[0].html).toBeUndefined();
    });

    it('starts empty', async () => {
      const res = await request(app.getHttpServer()).get('/api/demo/emails');
      expect(res.body).toEqual({ emails: [] });
    });

    it('keeps only the latest 50', async () => {
      for (let i = 0; i < 60; i++) {
        await mailbox.send({
          to: 'a@b.c',
          subject: `n${i}`,
          text: '',
          html: '',
        });
      }
      const res = await request(app.getHttpServer()).get('/api/demo/emails');
      expect(res.body.emails).toHaveLength(50);
      expect(res.body.emails[0].subject).toBe('n59');
    });

    it('is limited to 60 requests a minute', async () => {
      let last = 0;
      for (let i = 0; i < 61; i++) {
        last = (await request(app.getHttpServer()).get('/api/demo/emails'))
          .status;
      }
      expect(last).toBe(429);
    });

    it('makes the health check say it is a demo', async () => {
      const res = await request(app.getHttpServer()).get('/api/health');
      expect(res.body).toEqual({ status: 'ok', demo: true });
    });
  });

  describe('switched off', () => {
    let app: INestApplication<App>;
    let mailbox: DemoMailbox;
    let db: Kysely<DB>;
    beforeAll(async () => {
      ({ app, mailbox, db } = await appWith(false));
    });
    afterAll(async () => {
      await app.close();
      await db.destroy();
    });

    it('answers 404, as if the page were not there, even when it holds emails', async () => {
      await mailbox.send({
        to: 'a@b.c',
        subject: 'secret link',
        text: 'http://x/booking/token',
        html: '',
      });
      const res = await request(app.getHttpServer()).get('/api/demo/emails');
      expect(res.status).toBe(404);
      expect(res.text).not.toContain('secret');
    });

    it('does not mention demo in the health check', async () => {
      const res = await request(app.getHttpServer()).get('/api/health');
      expect(res.body).toEqual({ status: 'ok' });
    });
  });
});

describe('The real app outside demo mode', () => {
  it('has no demo mailbox', async () => {
    const { startHarness } = await import('../helpers/harness.js');
    const h = await startHarness('demooff');
    try {
      expect((await h.http().get('/api/demo/emails')).status).toBe(404);
      expect((await h.http().get('/api/health')).body).toEqual({
        status: 'ok',
      });
    } finally {
      await h.close();
    }
  });
});
