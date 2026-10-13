import { bookingWindow } from './booking-window.js';

const defaults = {
  minNoticeHours: 24,
  maxAdvanceDays: 90,
  minPaymentWindowHours: 2,
  depositPercent: '50.00',
  timeZone: 'Africa/Johannesburg', // UTC+2, no daylight saving
};

describe('bookingWindow', () => {
  const now = new Date('2026-10-09T10:00:00Z');

  it('starts after the notice plus the payment window when a deposit applies', () => {
    const window = bookingWindow(now, defaults);
    // 24 h notice + 2 h to pay
    expect(window.earliestStartAt).toBe('2026-10-10T12:00:00Z');
    // 90 days ahead
    expect(window.latestStartAt).toBe('2027-01-07T10:00:00Z');
    expect(window.timeZone).toBe('Africa/Johannesburg');
  });

  it('leaves out the payment window when there is no deposit (BR-9)', () => {
    const window = bookingWindow(now, { ...defaults, depositPercent: '0.00' });
    expect(window.earliestStartAt).toBe('2026-10-10T10:00:00Z');
  });

  it('gives the calendar days in the business time zone, not UTC', () => {
    // 22:30 UTC is 00:30 the next day in Johannesburg.
    const lateEvening = new Date('2026-10-09T20:30:00Z');
    const window = bookingWindow(lateEvening, {
      ...defaults,
      minNoticeHours: 0,
      minPaymentWindowHours: 2,
    });
    expect(window.earliestStartAt).toBe('2026-10-09T22:30:00Z');
    expect(window.firstDate).toBe('2026-10-10');
  });

  it('gives the last bookable day', () => {
    const window = bookingWindow(now, defaults);
    expect(window.firstDate).toBe('2026-10-10');
    expect(window.lastDate).toBe('2027-01-07');
  });

  it('follows other time zones', () => {
    // Sydney is UTC+11 in October: 12:00 UTC is 23:00 the same day.
    const window = bookingWindow(new Date('2026-10-09T01:00:00Z'), {
      ...defaults,
      timeZone: 'Australia/Sydney',
      minNoticeHours: 0,
      minPaymentWindowHours: 1,
    });
    expect(window.earliestStartAt).toBe('2026-10-09T02:00:00Z');
    expect(window.firstDate).toBe('2026-10-09');
  });
});
