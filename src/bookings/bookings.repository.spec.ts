import { ApiException } from '../common/api-error.js';
import { translateBookingError } from './bookings.repository.js';

// A PostgreSQL error as the pg driver reports it
const pgError = (code: string, constraint?: string) =>
  Object.assign(new Error('database error'), { code, constraint });

describe('translateBookingError (#43)', () => {
  it('turns the no-overlap exclusion violation into a friendly 409', () => {
    const translated = translateBookingError(
      pgError('23P01', 'bookings_no_overlap'),
    );
    expect(translated).toBeInstanceOf(ApiException);
    expect((translated as ApiException).getStatus()).toBe(409);
    expect((translated as ApiException).getResponse()).toEqual({
      statusCode: 409,
      code: 'SLOT_UNAVAILABLE',
      message: 'That time has just been booked. Please choose another time.',
      details: null,
    });
  });

  it('treats a deadlock between two simultaneous overlapping bookings as the same 409', () => {
    const translated = translateBookingError(pgError('40P01'));
    expect(translated).toBeInstanceOf(ApiException);
    expect((translated as ApiException).getStatus()).toBe(409);
    expect((translated as ApiException).getResponse()).toMatchObject({
      code: 'SLOT_UNAVAILABLE',
    });
  });

  it('leaves every other error alone', () => {
    const other = pgError('23505', 'bookings_reference_key');
    expect(translateBookingError(other)).toBe(other);
    const differentExclusion = pgError('23P01', 'some_other_exclusion');
    expect(translateBookingError(differentExclusion)).toBe(differentExclusion);
    const plain = new Error('boom');
    expect(translateBookingError(plain)).toBe(plain);
    expect(translateBookingError('text')).toBe('text');
  });
});
