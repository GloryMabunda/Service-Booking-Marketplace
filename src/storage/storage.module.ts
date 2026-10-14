import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolve } from 'node:path';
import type { Env } from '../config/env.js';
import { FILE_STORAGE } from './file-storage.js';
import { LocalFileStorage } from './local-file-storage.js';

// File storage (#67). The local disk provider keeps files in UPLOAD_DIR
// (default ./uploads, which is git-ignored and outside public/).
@Global()
@Module({
  providers: [
    {
      provide: FILE_STORAGE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new LocalFileStorage(
          resolve(config.get('UPLOAD_DIR', { infer: true }) ?? 'uploads'),
        ),
    },
  ],
  exports: [FILE_STORAGE],
})
export class StorageModule {}
