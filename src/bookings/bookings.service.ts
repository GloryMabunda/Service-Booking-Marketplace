import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Kysely, sql } from 'kysely';
import { AvailabilityService } from '../availability/availability.service.js';
import { isoUtc } from '../availability/time-zone.js';
import { ApiException } from '../common/api-error.js';
import { DATABASE } from '../database/database.module.js';
import type { DB } from '../database/database.types.js';
import { ServicesService } from '../services/services.service.js';
import { bankingDetailsAreSet } from '../settings/settings.schema.js';
import { SettingsService } from '../settings/settings.service.js';
import type { CreateBookingInput } from './booking.schema.js';
import { BOOKING_NOTIFIER, type BookingNotifier } from './booking-notifier.js';
import { planBooking } from './booking-plan.js';
import { generateBookingToken, hashBookingToken } from './booking-token.js';
import {
  type BookingRecord,
  BookingsRepository,
} from './bookings.repository.js';

// BR-11: at most this many Pending bookings per email address or phone number
const MAX_PENDING = 2;

// What POST /api/bookings returns (docs/api.md 4.3). The booking link token is
// never part of it (BR-15).
export interface CreatedBooking {
  booking: {
    reference: string;
    status: BookingRecord['status'];
    service: { name: string; durationMinutes: number };
    startAt: string;
    endAt: string;
    timeZone: string;
    price: string;
    depositAmount: string;
    depositDueAt: string | null;
  };
  // The address the booking email went to, or null if it couldn't be sent
  emailSentTo: string | null;
}

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly repository: BookingsRepository,
    private readonly availability: AvailabilityService,
    private readonly services: ServicesService,
    private readonly settings: SettingsService,
    @Inject(BOOKING_NOTIFIER) private readonly notifier: BookingNotifier,
  ) {}

  // Creates a booking (C-3, C-4). The server checks everything again, whatever
  // the page showed: the service, the slot (working hours, interval, bookings,
  // blocked time, notice, advance window and payment window), and the limit on
  // Pending bookings. `now` is a parameter so tests can fix the clock.
  async create(
    input: CreateBookingInput,
    now = new Date(),
  ): Promise<CreatedBooking> {
    // 1. An active service (BR-5)
    const service = await this.services.findActive(input.serviceId);
    if (!service) {
      throw new ApiException(
        400,
        'SERVICE_UNAVAILABLE',
        "That service isn't available.",
      );
    }

    const settings = await this.settings.get();
    const plan = planBooking({
      service: {
        price: await this.priceOf(service.id),
        durationMinutes: service.durationMinutes,
      },
      settings,
      startAt: input.startAt,
      now,
    });

    // 2. Payment details to show the client. Until the owner has entered her
    // banking details, a booking that needs a deposit would give the client
    // instructions with nowhere to pay (#28, #45).
    if (
      plan.status === 'pending' &&
      !bankingDetailsAreSet(settings.bankingDetails)
    ) {
      throw new ApiException(
        503,
        'BOOKING_NOT_READY',
        "Online booking isn't ready yet. Please contact us to book.",
      );
    }

    // 3. The slot, by the same rules that offered it. The database has the
    // last word (BR-2) if someone else books it a moment from now.
    if (!(await this.availability.isSlotOpen(service.id, input.startAt, now))) {
      throw new ApiException(
        409,
        'SLOT_UNAVAILABLE',
        'That time is no longer available. Please choose another time.',
      );
    }

    // 4. The token for the booking link: only its hash is saved (BR-15, #47)
    const token = generateBookingToken();

    // 5. Check the limit and save, in one transaction. Two requests from the
    // same person arriving together would both see "1 Pending booking" and both
    // pass; the advisory locks make the second wait for the first to finish.
    const booking = await this.db.transaction().execute(async (trx) => {
      await lockContact(trx, input.clientEmail, input.clientPhone);
      if (
        (await countPending(trx, input.clientEmail, input.clientPhone)) >=
        MAX_PENDING
      ) {
        throw new ApiException(
          409,
          'PENDING_LIMIT_REACHED',
          `You already have ${MAX_PENDING} bookings waiting for a deposit. Please pay for those, or wait for them to expire, before booking again.`,
        );
      }
      return this.repository.insert(
        {
          ...plan,
          serviceId: service.id,
          clientName: input.clientName,
          clientEmail: input.clientEmail,
          clientPhone: input.clientPhone,
          notes: input.notes,
          bookingTokenHash: hashBookingToken(token),
        },
        trx,
      );
    });

    // 6. Tell the client, after the booking is saved. A failure here never
    // loses or blocks the booking (spec section 7).
    const emailSent = await this.sendEmail(booking, token);

    return {
      booking: {
        reference: booking.reference,
        status: booking.status,
        service: {
          name: service.name,
          durationMinutes: service.durationMinutes,
        },
        startAt: isoUtc(booking.startAt),
        endAt: isoUtc(booking.endAt),
        timeZone: settings.timeZone,
        price: booking.priceAtBooking,
        depositAmount: booking.depositAmount,
        depositDueAt: booking.depositDueAt
          ? isoUtc(booking.depositDueAt)
          : null,
      },
      emailSentTo: emailSent ? booking.clientEmail : null,
    };
  }

  private async priceOf(serviceId: string): Promise<string> {
    const row = await this.db
      .selectFrom('services')
      .select('price')
      .where('id', '=', serviceId)
      .executeTakeFirstOrThrow();
    return row.price;
  }

  private async sendEmail(
    booking: BookingRecord,
    token: string,
  ): Promise<boolean> {
    try {
      return await this.notifier.bookingCreated(booking, token);
    } catch (error) {
      // Log the reference and the reason, never the token
      this.logger.error(
        `The email for ${booking.reference} could not be sent: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }
}

// Takes a transaction-scoped advisory lock on the email and on the phone, so
// bookings from the same person are counted one at a time. The locks are taken
// in a fixed order, so two requests can't wait on each other forever, and they
// are released when the transaction ends.
async function lockContact(
  trx: Kysely<DB>,
  email: string,
  phone: string,
): Promise<void> {
  const keys = [
    `booking-limit:email:${email}`,
    `booking-limit:phone:${phone}`,
  ].sort();
  for (const key of keys) {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`.execute(
      trx,
    );
  }
}

// Pending bookings under this email or this phone number (BR-11)
async function countPending(
  trx: Kysely<DB>,
  email: string,
  phone: string,
): Promise<number> {
  const row = await trx
    .selectFrom('bookings')
    .select(({ fn }) => fn.countAll<string>().as('count'))
    .where('status', '=', 'pending')
    .where(({ eb, fn }) =>
      eb.or([
        eb(fn('lower', ['client_email']), '=', email),
        eb('client_phone', '=', phone),
      ]),
    )
    .executeTakeFirstOrThrow();
  return Number(row.count);
}
