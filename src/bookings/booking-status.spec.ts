import {
  assertTransition,
  BOOKING_STATUSES,
  type BookingStatus,
  canTransition,
  holdsSlot,
  isFinal,
  nextStatuses,
} from './booking-status.js';

// The transition table from BR-3, written out independently of the code, so
// the test fails if the code and the specification ever drift apart.
const ALLOWED: [BookingStatus, BookingStatus][] = [
  ['pending', 'confirmed'], // the owner verifies payment
  ['pending', 'cancelled'],
  ['pending', 'expired'], // the scheduled job
  ['confirmed', 'completed'],
  ['confirmed', 'no_show'],
  ['confirmed', 'cancelled'],
];

describe('booking status transitions (BR-3, #49)', () => {
  it('allows exactly the transitions in the specification', () => {
    const allowed: [BookingStatus, BookingStatus][] = [];
    for (const from of BOOKING_STATUSES) {
      for (const to of BOOKING_STATUSES) {
        if (canTransition(from, to)) allowed.push([from, to]);
      }
    }
    expect(allowed).toEqual(ALLOWED);
  });

  describe.each(ALLOWED)('%s → %s', (from, to) => {
    it('is allowed', () => {
      expect(canTransition(from, to)).toBe(true);
      expect(() => assertTransition(from, to)).not.toThrow();
    });
  });

  // Every other pair of statuses, including a status to itself
  const forbidden = BOOKING_STATUSES.flatMap((from) =>
    BOOKING_STATUSES.map((to) => [from, to] as [BookingStatus, BookingStatus]),
  ).filter(([from, to]) => !ALLOWED.some(([f, t]) => f === from && t === to));

  it('covers every forbidden pair (6 x 6 minus the 6 allowed)', () => {
    expect(forbidden).toHaveLength(30);
  });

  describe.each(forbidden)('%s → %s', (from, to) => {
    it('is refused with 409 INVALID_STATUS_TRANSITION', () => {
      expect(canTransition(from, to)).toBe(false);
      expect(() => assertTransition(from, to)).toThrowError(
        expect.objectContaining({
          status: 409,
          response: expect.objectContaining({
            code: 'INVALID_STATUS_TRANSITION',
          }) as unknown,
        }) as Error,
      );
    });
  });

  it('writes the refusal in plain words', () => {
    expect(() => assertTransition('cancelled', 'confirmed')).toThrow(
      "A Cancelled booking can't be changed to Confirmed.",
    );
    expect(() => assertTransition('no_show', 'completed')).toThrow(
      "A No-show booking can't be changed to Completed.",
    );
  });

  describe('final statuses', () => {
    it.each(['completed', 'no_show', 'cancelled', 'expired'] as const)(
      '%s can never change',
      (status) => {
        expect(isFinal(status)).toBe(true);
        expect(nextStatuses(status)).toEqual([]);
        for (const to of BOOKING_STATUSES) {
          expect(canTransition(status, to)).toBe(false);
        }
      },
    );

    it.each(['pending', 'confirmed'] as const)('%s is not final', (status) => {
      expect(isFinal(status)).toBe(false);
    });
  });

  it('lists the next statuses from Pending and Confirmed', () => {
    expect(nextStatuses('pending')).toEqual([
      'confirmed',
      'cancelled',
      'expired',
    ]);
    expect(nextStatuses('confirmed')).toEqual([
      'completed',
      'no_show',
      'cancelled',
    ]);
  });
});

describe('holdsSlot (BR-1, BR-2)', () => {
  it('is true for Pending and Confirmed, and false for every other status', () => {
    expect(BOOKING_STATUSES.filter(holdsSlot)).toEqual([
      'pending',
      'confirmed',
    ]);
  });
});
