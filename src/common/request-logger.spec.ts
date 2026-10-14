import { maskBookingToken } from './request-logger.js';

const TOKEN = 'Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXU';

describe('maskBookingToken', () => {
  it.each([
    [`/booking/${TOKEN}`, '/booking/***'],
    [`/api/booking/${TOKEN}`, '/api/booking/***'],
    [`/api/booking/${TOKEN}/proofs`, '/api/booking/***/proofs'],
    [`/api/booking/${TOKEN}/cancel?x=1`, '/api/booking/***/cancel?x=1'],
    [`/booking/${TOKEN}?utm=a#frag`, '/booking/***?utm=a#frag'],
    [`/BOOKING/${TOKEN}`, '/BOOKING/***'],
    [`GET /api/booking/${TOKEN} 200`, 'GET /api/booking/*** 200'],
  ])('turns %s into %s', (input, expected) => {
    expect(maskBookingToken(input)).toBe(expected);
  });

  it('never leaves the token in the result', () => {
    for (const url of [
      `/booking/${TOKEN}`,
      `/api/booking/${TOKEN}/proofs`,
      `/x/booking/${TOKEN}/y/booking/${TOKEN}`,
    ]) {
      expect(maskBookingToken(url)).not.toContain(TOKEN);
    }
  });

  it('leaves other paths alone, including /api/bookings', () => {
    for (const url of [
      '/api/bookings',
      '/api/bookings/BK-000123/lookup',
      '/api/admin/bookings/abc',
      '/services.html',
      '/booking',
      '/booking/',
    ]) {
      expect(maskBookingToken(url)).toBe(url);
    }
  });
});
