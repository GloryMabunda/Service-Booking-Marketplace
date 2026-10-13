import { createHash, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { isoUtc } from '../availability/time-zone.js';
import { ApiException } from '../common/api-error.js';
import { DATABASE } from '../database/database.module.js';
import type { DB } from '../database/database.types.js';
import { SettingsService } from '../settings/settings.service.js';
import type { BookingStatus } from './booking-status.js';
import { derivePaymentStatus, type PaymentStatus } from './payment-status.js';

// A booking as a client sees it (docs/api.md, "BookingSummary"). The booking
// link is never part of it (BR-15).
export interface BookingSummary {
  reference: string;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  service: { name: string; durationMinutes: number };
  startAt: string;
  endAt: string;
  timeZone: string;
  price: string;
  depositAmount: string;
  depositDueAt: string | null;
  proofs: {
    uploadedAt: string;
    status: 'received' | 'accepted' | 'rejected';
    rejectionReason: string | null;
  }[];
}

export interface BookingLookup {
  booking: BookingSummary;
  // True while the booking is Pending or Confirmed and the appointment hasn't
  // started: a new booking link can be asked for (#58, M5)
  canResendBookingLink: boolean;
}

// One answer for a wrong reference and a wrong email, so the lookup can't be
// used to find out which bookings exist (docs/api.md 4.4, "No enumeration").
const NOT_FOUND = () =>
  new ApiException(
    404,
    'BOOKING_NOT_FOUND',
    "We couldn't find a booking with that reference and email. Check both and try again.",
  );

const REFERENCE = /^BK-\d{6,}$/;
const NO_BOOKING = '00000000-0000-0000-0000-000000000000';

@Injectable()
export class BookingLookupService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly settings: SettingsService,
  ) {}

  // Finds a booking by its reference and the email it was made with (C-6).
  // `email` is already lower-cased and checked by the request rules.
  async lookup(
    reference: string,
    email: string,
    now = new Date(),
  ): Promise<BookingLookup> {
    const row = REFERENCE.test(reference.trim().toUpperCase())
      ? await this.db
          .selectFrom('bookings')
          .innerJoin('services', 'services.id', 'bookings.service_id')
          .select([
            'bookings.id',
            'bookings.reference',
            'bookings.client_email',
            'bookings.status',
            'bookings.start_at',
            'bookings.end_at',
            'bookings.price_at_booking',
            'bookings.deposit_amount',
            'bookings.deposit_due_at',
            'bookings.payment_verified_at',
            'services.name as service_name',
          ])
          .where('bookings.reference', '=', reference.trim().toUpperCase())
          .executeTakeFirst()
      : undefined;

    // Compare the email the same way, taking the same time, whether or not a
    // booking was found.
    const matches = sameEmail(email, row?.client_email ?? '');
    // Always read the proofs too, so a found and a not-found answer do the
    // same work.
    const proofs = await this.db
      .selectFrom('payment_proofs')
      .select(['uploaded_at', 'status', 'rejection_reason'])
      .where('booking_id', '=', row?.id ?? NO_BOOKING)
      .orderBy('uploaded_at')
      .execute();

    if (!row || !matches) throw NOT_FOUND();

    const { timeZone } = await this.settings.get();
    const startAt = new Date(row.start_at);
    const endAt = new Date(row.end_at);
    return {
      booking: {
        reference: row.reference,
        status: row.status,
        paymentStatus: derivePaymentStatus({
          status: row.status,
          depositAmount: row.deposit_amount,
          paymentVerifiedAt: row.payment_verified_at
            ? new Date(row.payment_verified_at)
            : null,
          proofs: proofs.map((p) => ({ status: p.status })),
        }),
        service: {
          name: row.service_name,
          durationMinutes: (endAt.getTime() - startAt.getTime()) / 60_000,
        },
        startAt: isoUtc(startAt),
        endAt: isoUtc(endAt),
        timeZone,
        price: row.price_at_booking,
        depositAmount: row.deposit_amount,
        depositDueAt: row.deposit_due_at
          ? isoUtc(new Date(row.deposit_due_at))
          : null,
        proofs: proofs.map((p) => ({
          uploadedAt: isoUtc(new Date(p.uploaded_at)),
          status: p.status,
          rejectionReason: p.rejection_reason,
        })),
      },
      canResendBookingLink:
        (row.status === 'pending' || row.status === 'confirmed') &&
        now < startAt,
    };
  }
}

// Compares two emails ignoring capitals, in constant time (hashing first
// makes both the same length)
function sameEmail(given: string, stored: string): boolean {
  const digest = (s: string) =>
    createHash('sha256').update(s.trim().toLowerCase()).digest();
  const a = digest(given);
  const b = digest(stored);
  return timingSafeEqual(a, b) && stored !== '';
}
