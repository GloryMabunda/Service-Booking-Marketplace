import type { INestApplication, NestApplicationOptions } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { Request, Response } from 'express';
import { join } from 'node:path';
import { requestLogger } from './common/request-logger.js';
import { AppModule } from './app.module.js';

// The setup every running app has. createApp uses it, and so do tests that
// build the app from a testing module (to swap a provider for a fake), so they
// run the app the way production does.
export function configureApp(app: INestApplication): void {
  // Every endpoint lives under /api (docs/api.md); the rest of the URL space
  // is the public website in public/.
  app.setGlobalPrefix('api');
  // JSON request bodies are limited to 16 KB (docs/api.md section 1).
  (app as unknown as NestExpressApplication).useBodyParser('json', {
    limit: '16kb',
  });
  // Reads the session cookie (#27).
  app.use(cookieParser());
  // Logs requests, with booking link tokens masked (#68).
  app.use(requestLogger());

  // The booking page opened from the emailed link: /booking/<token> (BR-15,
  // C-7). The same file for every token: the page asks the API about its
  // link, so an unknown token and an unusable one look identical. It is
  // served here, outside /api, with headers that keep the token out of
  // referrers and caches, and out of search engines.
  app
    .getHttpAdapter()
    .get('/booking/:token', (_req: Request, res: Response) => {
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Robots-Tag', 'noindex');
      res.sendFile(join(import.meta.dirname, '..', 'public', 'booking.html'));
    });
}

// Builds the app exactly as it runs in production. main.ts and the API tests
// both use this: Test.createTestingModule creates modules before the HTTP
// server exists, which switches off ServeStaticModule and would hide a broken
// website (#23). Tests may pass a root module that imports AppModule plus
// test-only controllers.
export async function createApp<T extends INestApplication = INestApplication>(
  options?: NestApplicationOptions,
  rootModule: Parameters<typeof NestFactory.create>[0] = AppModule,
): Promise<T> {
  const app = await NestFactory.create<T>(rootModule, options);
  configureApp(app);
  return app;
}
