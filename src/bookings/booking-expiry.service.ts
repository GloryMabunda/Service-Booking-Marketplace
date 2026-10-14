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
import { BOOKING_NOTIFIER, type BookingNotifier } from './booking-notifier.js';
import { BookingsRepository } from './bookings.repository.js';

// Expires unpaid bookings (BR-9, #50): a Pending booking holds its slot until
// its deposit deadline, then becomes Expired and the slot reopens.

const EVERY_MS = 5 * 60_000; // every 5 minutes
const FIRST_RUN_MS = 15_000; // and shortly after the app starts

export interface ExpiredBooking {
  id: string;
  reference: string;
  clientEmail: string;
}

@Injectable()
export class BookingExpiryService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(BookingExpiryService.name);
  private timers: NodeJS.Timeout[] = [];

  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly config: ConfigService<Env, true>,
    private readonly bookings: BookingsRepository,
    @Inject(BOOKING_NOTIFIER) private readonly notifier: BookingNotifier,
  ) {}

  // Starts the schedule. Tests (NODE_ENV=test) call run() themselves instead of
  // having a timer in the background.
  onApplicationBootstrap(): void {
    if (this.config.get('NODE_ENV', { infer: true }) === 'test') return;
    const first = setTimeout(() => void this.runSafely(), FIRST_RUN_MS);
    const every = setInterval(() => void this.runSafely(), EVERY_MS);
    // A timer must never keep the process alive
    first.unref();
    every.unref();
    this.timers = [first, every];
  }

  onApplicationShutdown(): void {
    for (const timer of this.timers) {
      clearTimeout(timer);
      clearInterval(timer);
    }
    this.timers = [];
  }

  // Marks every Pending booking past its deadline as Expired and returns them.
  // One conditional update (WHERE status = 'pending' AND the deadline has
  // passed), so it is safe to run twice, or from two app instances at once:
  // each booking can only be expired once. An uploaded proof doesn't stop it:
  // the owner decides on payment only after her bank check (BR-9). Expiring is
  // the Pending → Expired transition of BR-3, and the expired booking stops
  // holding its slot (BR-2).
  async run(now = new Date()): Promise<ExpiredBooking[]> {
    const rows = await this.db
      .updateTable('bookings')
      .set({ status: 'expired', updated_at: now })
      .where('status', '=', 'pending')
      .where('deposit_due_at', '<=', now)
      .returning(['id', 'reference', 'client_email'])
      .execute();
    return rows.map((row) => ({
      id: row.id,
      reference: row.reference,
      clientEmail: row.client_email,
    }));
  }

  // Expires the unpaid bookings, then tells each client by email (4.5). A
  // failed email is logged and never undoes the expiry.
  async expireAndNotify(now = new Date()): Promise<ExpiredBooking[]> {
    const expired = await this.run(now);
    for (const { id, reference } of expired) {
      try {
        const booking = await this.bookings.findById(id);
        if (booking) await this.notifier.bookingExpired(booking);
      } catch (error) {
        this.logger.error(
          `The expiry email for ${reference} could not be sent: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return expired;
  }

  private async runSafely(): Promise<void> {
    try {
      const expired = await this.expireAndNotify();
      if (expired.length > 0) {
        this.logger.log(
          `Expired ${expired.length} unpaid booking(s): ${expired.map((b) => b.reference).join(', ')}`,
        );
      }
    } catch (error) {
      // A failed run is tried again in 5 minutes
      this.logger.error(
        `Expiring unpaid bookings failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
