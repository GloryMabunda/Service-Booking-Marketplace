import { planBooking } from './booking-plan.js';

const settings = {
  depositPercent: '50.00',
  depositHoldHours: 24,
  minNoticeHours: 24,
  bufferMinutes: 60,
};
const softGlam = { price: '650.00', durationMinutes: 90 };

const plan = (
  overrides: {
    service?: Partial<typeof softGlam>;
    settings?: Partial<typeof settings>;
    startAt?: string;
    now?: string;
  } = {},
) =>
  planBooking({
    service: { ...softGlam, ...overrides.service },
    settings: { ...settings, ...overrides.settings },
    startAt: new Date(overrides.startAt ?? '2026-11-03T07:00:00Z'),
    now: new Date(overrides.now ?? '2026-10-20T10:00:00Z'),
  });

describe('planBooking', () => {
  describe('the snapshot (BR-4, #42)', () => {
    it('works out the end, the end of the buffer, the price and the deposit', () => {
      const result = plan();
      expect(result.startAt.toISOString()).toBe('2026-11-03T07:00:00.000Z');
      expect(result.endAt.toISOString()).toBe('2026-11-03T08:30:00.000Z');
      // 90-minute service plus a 60-minute buffer
      expect(result.occupiedUntil.toISOString()).toBe(
        '2026-11-03T09:30:00.000Z',
      );
      expect(result.priceAtBooking).toBe('650.00');
      expect(result.depositAmount).toBe('325.00');
    });

    it('follows the buffer and the duration it is given', () => {
      const result = plan({
        service: { durationMinutes: 150 },
        settings: { bufferMinutes: 0 },
      });
      expect(result.endAt.toISOString()).toBe('2026-11-03T09:30:00.000Z');
      expect(result.occupiedUntil).toEqual(result.endAt);
    });
  });

  describe('the deposit (BR-7)', () => {
    it.each([
      ['50.00', '650.00', '325.00'],
      ['30.00', '650.00', '195.00'],
      ['50.00', '1200.50', '600.25'],
      ['100.00', '650.00', '650.00'],
      ['33.33', '99.99', '33.33'],
    ])('%s%% of %s is %s', (depositPercent, price, expected) => {
      expect(
        plan({ settings: { depositPercent }, service: { price } })
          .depositAmount,
      ).toBe(expected);
    });

    it('rounds half-up to the cent', () => {
      expect(
        plan({
          settings: { depositPercent: '50.00' },
          service: { price: '0.03' },
        }).depositAmount,
      ).toBe('0.02');
    });

    it('writes the price with two decimals', () => {
      expect(plan({ service: { price: '650' } }).priceAtBooking).toBe('650.00');
    });
  });

  describe('the starting status (BR-3, #46)', () => {
    it('is Pending, with a deadline, when a deposit applies', () => {
      const result = plan();
      expect(result.status).toBe('pending');
      expect(result.depositDueAt).toBeInstanceOf(Date);
    });

    it('is Confirmed, with no deadline, when the deposit percentage is 0', () => {
      const result = plan({ settings: { depositPercent: '0.00' } });
      expect(result).toMatchObject({
        status: 'confirmed',
        depositAmount: '0.00',
        depositDueAt: null,
      });
    });

    it('is Confirmed for a free service, whatever the percentage', () => {
      expect(plan({ service: { price: '0.00' } })).toMatchObject({
        status: 'confirmed',
        depositAmount: '0.00',
        depositDueAt: null,
      });
    });

    it('is Confirmed when the percentage rounds down to nothing', () => {
      // 10% of R0.04 is R0.004, which is R0.00: nothing to pay
      expect(
        plan({
          settings: { depositPercent: '10.00' },
          service: { price: '0.04' },
        }),
      ).toMatchObject({ status: 'confirmed', depositAmount: '0.00' });
    });
  });

  describe('the deposit deadline: the earlier of the hold and the notice cutoff (BR-9)', () => {
    it('is the hold duration after booking when the appointment is far away', () => {
      // booked 20 Oct 10:00, appointment 3 Nov 07:00: hold ends 21 Oct 10:00,
      // the notice cutoff is 2 Nov 07:00
      expect(plan().depositDueAt?.toISOString()).toBe(
        '2026-10-21T10:00:00.000Z',
      );
    });

    it('is the minimum-notice cutoff when the appointment is soon', () => {
      // booked 1 Nov 10:00 for 3 Nov 07:00: hold would end 2 Nov 10:00, but
      // the cutoff 24 h before the appointment is 2 Nov 07:00, which is earlier
      expect(
        plan({ now: '2026-11-01T10:00:00Z' }).depositDueAt?.toISOString(),
      ).toBe('2026-11-02T07:00:00.000Z');
    });

    it('is the cutoff exactly when both are the same moment', () => {
      expect(
        plan({ now: '2026-11-01T07:00:00Z' }).depositDueAt?.toISOString(),
      ).toBe('2026-11-02T07:00:00.000Z');
    });

    it('follows the hold and the notice settings', () => {
      expect(
        plan({ settings: { depositHoldHours: 6 } }).depositDueAt?.toISOString(),
      ).toBe('2026-10-20T16:00:00.000Z');
      expect(
        plan({
          now: '2026-11-02T20:00:00Z',
          settings: { depositHoldHours: 48, minNoticeHours: 12 },
        }).depositDueAt?.toISOString(),
      ).toBe('2026-11-02T19:00:00.000Z'); // 12 h before 3 Nov 07:00, already past
    });

    it('leaves the client at least the minimum payment window for a booking the slot rules allow', () => {
      // The earliest start the rules offer is now + notice + a 2 h payment window.
      const now = '2026-11-01T10:00:00Z';
      const earliestStart = '2026-11-02T12:00:00Z'; // 24 h + 2 h later
      const due = plan({ now, startAt: earliestStart }).depositDueAt!;
      expect(due.getTime() - new Date(now).getTime()).toBeGreaterThanOrEqual(
        2 * 3_600_000,
      );
    });
  });
});
