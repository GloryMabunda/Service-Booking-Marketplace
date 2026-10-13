import { Injectable, Logger } from '@nestjs/common';
import type { BookingRecord } from './bookings.repository.js';

// How a client is told about a new booking. The booking link token goes into
// the email and nowhere else (BR-15), so it is handed over here, in memory,
// right after the booking is saved.
//
// M5 provides the real implementation (payment instructions email, #56).
// Until then NoEmailNotifier sends nothing and says so, so a booking never
// claims an email that wasn't sent.
export interface BookingNotifier {
  // Returns true when the client's email was sent. Must not throw: a failure
  // never loses or blocks a booking (spec section 7).
  bookingCreated(booking: BookingRecord, token: string): Promise<boolean>;
}

export const BOOKING_NOTIFIER = Symbol('BOOKING_NOTIFIER');

@Injectable()
export class NoEmailNotifier implements BookingNotifier {
  private readonly logger = new Logger('BookingNotifier');

  bookingCreated(booking: BookingRecord): Promise<boolean> {
    // The reference is safe to log; the token never is.
    this.logger.warn(
      `No email provider yet (M5): ${booking.reference} was saved, but no email was sent.`,
    );
    return Promise.resolve(false);
  }
}
