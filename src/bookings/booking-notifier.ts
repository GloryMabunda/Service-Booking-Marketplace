import type { BookingRecord } from './bookings.repository.js';

// How people are told about a booking. The booking link token goes into the
// email and nowhere else (BR-15), so it is handed over here, in memory, right
// after it is made. The real implementation sends emails (src/notifications);
// tests swap in a recording one.
//
// None of these may throw: a failed email never loses or blocks a booking
// (spec section 7). The ones that return a boolean say whether the client's
// email was sent, so a page never claims an email that wasn't.
export interface BookingNotifier {
  // A booking was just made: the client's email (payment instructions, or the
  // confirmation when no deposit is needed) and the owner's.
  bookingCreated(booking: BookingRecord, token: string): Promise<boolean>;

  // A new booking link was issued: it is emailed to the client (C-6).
  bookingLinkReissued(booking: BookingRecord, token: string): Promise<boolean>;

  // The deposit wasn't received in time: the client is told (BR-9).
  bookingExpired(booking: BookingRecord): Promise<void>;

  // The owner confirmed the deposit: the client gets the confirmation with a
  // fresh booking link (BR-8, BR-15). Returns whether the email was sent.
  bookingConfirmed(booking: BookingRecord, token: string): Promise<boolean>;

  // The booking was cancelled (BR-12): the client is told, with what happens
  // to their deposit. Returns whether the email was sent.
  bookingCancelled(booking: BookingRecord): Promise<boolean>;
}

export const BOOKING_NOTIFIER = Symbol('BOOKING_NOTIFIER');
