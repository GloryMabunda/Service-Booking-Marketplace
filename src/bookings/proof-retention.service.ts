import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Kysely } from 'kysely';
import type { Env } from '../config/env.js';
import { DATABASE } from '../database/database.module.js';
import type { DB } from '../database/database.types.js';
import { FILE_STORAGE, type FileStorage } from '../storage/file-storage.js';

// Proof files are deleted 90 days after the booking reaches a final status
// (Completed, No-show, Cancelled or Expired), keeping only their records, in
// line with POPIA (BR-14, #77). A fixed system rule, not a setting.
export const RETENTION_DAYS = 90;

// A file with no record is only removed once it is this old, so a file that is
// still being recorded by an upload is never touched
const STRAY_GRACE_MS = 60 * 60_000;

const DAY_MS = 24 * 3_600_000;
const FIRST_RUN_MS = 60_000;

export interface RetentionResult {
  // Proof files deleted because their booking finished 90 or more days ago
  deleted: number;
  // Files with no proof record at all, left by an upload that failed half way
  strays: number;
}

@Injectable()
export class ProofRetentionService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(ProofRetentionService.name);
  private timers: NodeJS.Timeout[] = [];

  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    private readonly config: ConfigService<Env, true>,
  ) {}

  // Runs a minute after the app starts and then every day. Tests
  // (NODE_ENV=test) call run() themselves.
  onApplicationBootstrap(): void {
    if (this.config.get('NODE_ENV', { infer: true }) === 'test') return;
    const first = setTimeout(() => void this.runSafely(), FIRST_RUN_MS);
    const daily = setInterval(() => void this.runSafely(), DAY_MS);
    first.unref();
    daily.unref();
    this.timers = [first, daily];
  }

  onApplicationShutdown(): void {
    for (const timer of this.timers) {
      clearTimeout(timer);
      clearInterval(timer);
    }
    this.timers = [];
  }

  async run(now = new Date()): Promise<RetentionResult> {
    const deleted = await this.deleteExpiredFiles(now);
    const strays = await this.deleteStrayFiles(now);
    return { deleted, strays };
  }

  // The file goes first, then the record says so (file_deleted_at). If the
  // file can't be removed, the record is left alone and tried again tomorrow.
  private async deleteExpiredFiles(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - RETENTION_DAYS * DAY_MS);
    const due = await this.db
      .selectFrom('payment_proofs')
      .innerJoin('bookings', 'bookings.id', 'payment_proofs.booking_id')
      .select(['payment_proofs.id', 'payment_proofs.storage_key'])
      .where('payment_proofs.file_deleted_at', 'is', null)
      .where('bookings.status', 'in', [
        'completed',
        'no_show',
        'cancelled',
        'expired',
      ])
      // When it reached its final status: the cancellation time for a
      // cancelled booking, otherwise the last change (the status change itself)
      .where((eb) =>
        eb(
          eb.fn.coalesce('bookings.cancelled_at', 'bookings.updated_at'),
          '<=',
          cutoff,
        ),
      )
      .execute();

    let deleted = 0;
    for (const proof of due) {
      try {
        await this.storage.delete('private', proof.storage_key);
        await this.db
          .updateTable('payment_proofs')
          .set({ file_deleted_at: now })
          .where('id', '=', proof.id)
          .where('file_deleted_at', 'is', null)
          .execute();
        deleted += 1;
      } catch (error) {
        this.logger.error(
          `Could not delete proof file ${proof.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return deleted;
  }

  // Files nobody has a record of, for example when the app stopped between
  // saving a file and recording it
  private async deleteStrayFiles(now: Date): Promise<number> {
    const keys = await this.storage.list('private');
    if (keys.length === 0) return 0;
    const known = new Set(
      (
        await this.db
          .selectFrom('payment_proofs')
          .select('storage_key')
          .where('storage_key', 'in', keys)
          .execute()
      ).map((row) => row.storage_key),
    );

    let removed = 0;
    for (const key of keys) {
      if (known.has(key)) continue;
      try {
        const written = await this.storage.modifiedAt('private', key);
        if (!written || now.getTime() - written.getTime() < STRAY_GRACE_MS) {
          continue;
        }
        await this.storage.delete('private', key);
        removed += 1;
      } catch (error) {
        this.logger.error(
          `Could not remove stray file ${key}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return removed;
  }

  private async runSafely(): Promise<void> {
    try {
      const { deleted, strays } = await this.run();
      if (deleted > 0 || strays > 0) {
        this.logger.log(
          `Proof retention: deleted ${deleted} file(s) past ${RETENTION_DAYS} days and ${strays} stray file(s)`,
        );
      }
    } catch (error) {
      // A failed run is tried again tomorrow
      this.logger.error(
        `Proof retention failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
