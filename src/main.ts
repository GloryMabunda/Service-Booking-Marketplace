import { ConfigService } from '@nestjs/config';
import { createApp } from './app.factory.js';
import type { Env } from './config/env.js';

async function bootstrap() {
  const app = await createApp();
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  await app.listen(config.get('PORT', { infer: true }));
}
await bootstrap();
