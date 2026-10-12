import {
  Global,
  Inject,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Kysely } from 'kysely';
import type { Env } from '../config/env.js';
import { createDatabase } from './database.js';
import type { DB } from './database.types.js';

// The app's one connection pool, injected with @Inject(DATABASE).
export const DATABASE = Symbol('DATABASE');

@Global()
@Module({
  providers: [
    {
      provide: DATABASE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        createDatabase(config.get('DATABASE_URL', { infer: true })),
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  // Closes the pool when the app stops, so tests and restarts don't leak
  // connections.
  async onApplicationShutdown(): Promise<void> {
    await this.db.destroy();
  }
}
