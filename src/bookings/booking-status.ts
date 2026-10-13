import { ApiException } from '../common/api-error.js';
import type { BookingStatus } from '../database/database.types.js';

// Booking statuses and the changes allowed between them (BR-3, #49). Every
// caller that changes a status goes through assertTransition, so the rules
// live in one place.
//
//   Pending   → Confirmed (the owner verifies payment), Cancelled, Expired
//   Confirmed → Completed, No-show, Cancelled
//   Completed, No-show, Cancelled, Expired are final.

export type { BookingStatus };

export const BOOKING_STATUSES: readonly BookingStatus[] = [
  'pending',
  'confirmed',
  'completed',
  'no_show',
  'cancelled',
  'expired',
];

const ALLOWED: Record<BookingStatus, readonly BookingStatus[]> = {
  pending: ['confirmed', 'cancelled', 'expired'],
  confirmed: ['completed', 'no_show', 'cancelled'],
  completed: [],
  no_show: [],
  cancelled: [],
  expired: [],
};

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return ALLOWED[from].includes(to);
}

// A final status can never change.
export function isFinal(status: BookingStatus): boolean {
  return ALLOWED[status].length === 0;
}

// Pending and Confirmed bookings hold their slot (BR-1, BR-2); the others
// free it.
export function holdsSlot(status: BookingStatus): boolean {
  return status === 'pending' || status === 'confirmed';
}

// The statuses a booking can move to from here.
export function nextStatuses(from: BookingStatus): readonly BookingStatus[] {
  return ALLOWED[from];
}

// Throws 409 INVALID_STATUS_TRANSITION (docs/api.md section 2) unless the
// change is allowed. Callers pass the status they just read, and use a
// conditional update (WHERE status = from) so a change made a moment ago by
// someone else is caught too.
export function assertTransition(from: BookingStatus, to: BookingStatus): void {
  if (!canTransition(from, to)) {
    throw new ApiException(
      409,
      'INVALID_STATUS_TRANSITION',
      `A ${label(from)} booking can't be changed to ${label(to)}.`,
    );
  }
}

const LABELS: Record<BookingStatus, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  completed: 'Completed',
  no_show: 'No-show',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

function label(status: BookingStatus): string {
  return LABELS[status];
}
