import type { INestApplication, NestApplicationOptions } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

// Builds the app exactly as it runs in production. main.ts and the API tests
// both use this, so tests exercise the real setup: Test.createTestingModule
// creates modules before the HTTP server exists, which switches off
// ServeStaticModule and would hide a broken website (#23).
export async function createApp<T extends INestApplication = INestApplication>(
  options?: NestApplicationOptions,
): Promise<T> {
  const app = await NestFactory.create<T>(AppModule, options);
  // Every endpoint lives under /api (docs/api.md); the rest of the URL space
  // is the public website in public/.
  app.setGlobalPrefix('api');
  return app;
}
