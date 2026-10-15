import { Inject, Injectable } from '@nestjs/common';
import type { Kysely, Selectable } from 'kysely';
import { ApiException } from '../common/api-error.js';
import { DATABASE } from '../database/database.module.js';
import type { DB } from '../database/database.types.js';
import { isPgError } from '../database/pg-errors.js';
import type { BookingPlan } from './booking-plan.js';
import type { BookingStatus } from './booking-status.js';

// A saved booking, with the price, duration and deposit it was made with
// (BR-4): later edits to the service or the settings never change these.
export interface BookingRecord {
  id: string;
  reference: string; // "BK-000123"
  serviceId: string;
  clientName: string;
  clientEmail: string;
  clientPhone: string; // E.164
  startAt: Date;
  endAt: Date;
  occupiedFrom: Date;
  occupiedUntil: Date;
  location: 'studio' | 'client';
  appointmentAddress: string | null;
  travelDistanceKm: string | null;
  travelCallOutFee: string | null;
  travelRatePerKm: string | null;
  travelFee: string;
  priceAtBooking: string;
  depositAmount: string;
  depositDueAt: Date | null;
  status: BookingStatus;
  notes: string | null;
  amountReceived: string | null;
  refundDue: boolean;
  cancelledBy: 'admin' | 'client' | null;
  createdAt: Date;
}

export interface NewBooking extends BookingPlan {
  serviceId: string;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  notes: string | null;
  // SHA-256 of the booking link token (BR-15); the token itself is never stored
  bookingTokenHash?: Buffer;
}

function toRecord(row: Selectable<DB['bookings']>): BookingRecord {
  return {
    id: row.id,
    reference: row.reference,
    serviceId: row.service_id,
    clientName: row.client_name,
    clientEmail: row.client_email,
    clientPhone: row.client_phone,
    startAt: new Date(row.start_at),
    endAt: new Date(row.end_at),
    occupiedFrom: new Date(row.occupied_from ?? row.start_at),
    occupiedUntil: new Date(row.occupied_until),
    location: row.location,
    appointmentAddress: row.appointment_address,
    travelDistanceKm: row.travel_distance_km,
    travelCallOutFee: row.travel_call_out_fee,
    travelRatePerKm: row.travel_rate_per_km,
    travelFee: row.travel_fee,
    priceAtBooking: row.price_at_booking,
    depositAmount: row.deposit_amount,
    depositDueAt: row.deposit_due_at ? new Date(row.deposit_due_at) : null,
    status: row.status,
    notes: row.notes,
    amountReceived: row.amount_received,
    refundDue: row.refund_due,
    cancelledBy: row.cancelled_by,
    createdAt: new Date(row.created_at),
  };
}

// The exclusion constraint bookings_no_overlap (BR-2, #43) refused a booking
// because its time, buffer included, overlaps a Pending or Confirmed one:
// the other client got there first. Everything else passes through unchanged.
export function translateBookingError(error: unknown): unknown {
  // 40P01 deadlock_detected: two overlapping bookings saved at the same moment
  // can wait on each other while the constraint checks them; PostgreSQL ends
  // one. For the client that is the same as losing the slot.
  if (
    isPgError(error, '23P01', 'bookings_no_overlap') ||
    isPgError(error, '40P01')
  ) {
    return new ApiException(
      409,
      'SLOT_UNAVAILABLE',
      'That time has just been booked. Please choose another time.',
    );
  }
  return error;
}

@Injectable()
export class BookingsRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  // Saves a booking. The database decides whether the time is free, even when
  // two requests arrive in the same instant (BR-2), and gives the booking its
  // reference. Pass a transaction as `executor` to save it together with other
  // changes.
  async insert(
    booking: NewBooking,
    executor: Kysely<DB> = this.db,
  ): Promise<BookingRecord> {
    try {
      const row = await executor
        .insertInto('bookings')
        .values({
          service_id: booking.serviceId,
          client_name: booking.clientName,
          client_email: booking.clientEmail,
          client_phone: booking.clientPhone,
          start_at: booking.startAt,
          end_at: booking.endAt,
          occupied_from: booking.occupiedFrom,
          occupied_until: booking.occupiedUntil,
          location: booking.location,
          appointment_address: booking.appointmentAddress,
          travel_distance_km: booking.travelDistanceKm,
          travel_call_out_fee: booking.travelCallOutFee,
          travel_rate_per_km: booking.travelRatePerKm,
          travel_fee: booking.travelFee,
          price_at_booking: booking.priceAtBooking,
          deposit_amount: booking.depositAmount,
          deposit_due_at: booking.depositDueAt,
          status: booking.status,
          notes: booking.notes,
          ...(booking.bookingTokenHash
            ? {
                booking_token_hash: booking.bookingTokenHash,
                booking_token_created_at: new Date(),
              }
            : {}),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return toRecord(row);
    } catch (error) {
      throw translateBookingError(error);
    }
  }

  // Replaces the booking link (BR-15): the old link stops working at once.
  // Only a Pending or Confirmed booking whose appointment hasn't started gets
  // a new one; for any other booking this returns null and changes nothing.
  async reissueLink(
    id: string,
    tokenHash: Buffer,
    now = new Date(),
  ): Promise<BookingRecord | null> {
    const row = await this.db
      .updateTable('bookings')
      .set({
        booking_token_hash: tokenHash,
        booking_token_created_at: now,
        updated_at: now,
      })
      .where('id', '=', id)
      .where('status', 'in', ['pending', 'confirmed'])
      .where('start_at', '>', now)
      .returningAll()
      .executeTakeFirst();
    return row ? toRecord(row) : null;
  }

  async findById(id: string): Promise<BookingRecord | null> {
    const row = await this.db
      .selectFrom('bookings')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? toRecord(row) : null;
  }
}
