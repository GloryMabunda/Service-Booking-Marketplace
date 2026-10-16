import { bankingDetailsAreSet } from '../settings/settings.schema.js';
import { createBookingSchema } from './booking.schema.js';

const valid = {
  serviceId: '5b0f6c3e-2f4a-4c55-9a43-3c1f5e2f8a10',
  startAt: '2026-11-03T07:00:00Z',
  clientName: 'Sarah Mokoena',
  clientEmail: 'sarah@example.com',
  clientPhone: '082 123 4567',
  notes: 'Birthday makeup',
};

const problems = (body: unknown) => {
  const result = createBookingSchema.safeParse(body);
  return result.success
    ? []
    : result.error.issues.map(
        (i) => `${i.path.join('.') || '(body)'}: ${i.message}`,
      );
};

describe('createBookingSchema (C-3, C-4)', () => {
  it('accepts the example from docs/api.md and tidies it', () => {
    expect(createBookingSchema.parse(valid)).toEqual({
      serviceId: valid.serviceId,
      startAt: new Date('2026-11-03T07:00:00Z'),
      clientName: 'Sarah Mokoena',
      clientEmail: 'sarah@example.com',
      clientPhone: '+27821234567',
      notes: 'Birthday makeup',
      location: 'studio',
    });
  });

  it('trims the name and lower-cases the email, so one person has one address', () => {
    const result = createBookingSchema.parse({
      ...valid,
      clientName: '  Sarah Mokoena ',
      clientEmail: '  Sarah@Example.COM ',
    });
    expect(result.clientName).toBe('Sarah Mokoena');
    expect(result.clientEmail).toBe('sarah@example.com');
  });

  it('writes the phone number the one way, however it was typed (BR-11)', () => {
    for (const phone of [
      '082 123 4567',
      '0821234567',
      '+27 82 123 4567',
      '27821234567',
      '(082) 123-4567',
    ]) {
      expect(
        createBookingSchema.parse({ ...valid, clientPhone: phone }).clientPhone,
      ).toBe('+27821234567');
    }
  });

  it('makes the notes optional: missing, null and empty all mean none', () => {
    const { notes: _notes, ...withoutNotes } = valid;
    expect(createBookingSchema.parse(withoutNotes).notes).toBeNull();
    expect(
      createBookingSchema.parse({ ...valid, notes: null }).notes,
    ).toBeNull();
    expect(
      createBookingSchema.parse({ ...valid, notes: '   ' }).notes,
    ).toBeNull();
  });

  it('names every missing required field', () => {
    expect(problems({})).toEqual([
      'serviceId: Choose a service.',
      'startAt: Choose a date and time.',
      'clientName: Enter your name.',
      'clientEmail: Enter a valid email address.',
      'clientPhone: Enter a South African phone number.',
    ]);
  });

  it.each([
    [{ serviceId: 'nope' }, 'serviceId: Choose a service.'],
    [{ startAt: '2026-11-03' }, 'startAt: Choose a date and time.'],
    [{ startAt: '2026-11-03T09:00:00' }, 'startAt: Choose a date and time.'],
    [{ clientName: '   ' }, 'clientName: Enter your name.'],
    [
      { clientName: 'x'.repeat(101) },
      'clientName: The name must be at most 100 characters.',
    ],
    [{ clientEmail: 'sarah@' }, 'clientEmail: Enter a valid email address.'],
    [
      { clientEmail: `${'a'.repeat(250)}@x.co` },
      'clientEmail: Enter a valid email address.',
    ],
    [
      { clientPhone: '+44 20 7946 0958' },
      'clientPhone: Enter a South African phone number.',
    ],
    [
      { clientPhone: '12345' },
      'clientPhone: Enter a South African phone number.',
    ],
    [
      { notes: 'x'.repeat(1001) },
      'notes: The notes must be at most 1,000 characters.',
    ],
  ])('rejects %j', (change, message) => {
    expect(problems({ ...valid, ...change })).toEqual([message]);
  });

  it('accepts notes of exactly 1,000 characters', () => {
    expect(
      createBookingSchema.safeParse({ ...valid, notes: 'x'.repeat(1000) })
        .success,
    ).toBe(true);
  });

  it('rejects unknown fields, so nothing unexpected is saved', () => {
    expect(problems({ ...valid, status: 'confirmed' })).toEqual([
      '(body): Unrecognized key: "status"',
    ]);
  });
});

describe('bankingDetailsAreSet (#28, #45)', () => {
  const real = {
    accountName: 'Fresh Start',
    bank: 'Example Bank',
    accountNumber: '1234567890',
    branchCode: '250655',
    accountType: 'Cheque',
  };

  it('is true once all five details are real', () => {
    expect(bankingDetailsAreSet(real)).toBe(true);
  });

  it('is false while any detail is still the "Not set yet" placeholder', () => {
    const placeholder = 'Not set yet';
    expect(
      bankingDetailsAreSet({
        accountName: placeholder,
        bank: placeholder,
        accountNumber: placeholder,
        branchCode: placeholder,
        accountType: placeholder,
      }),
    ).toBe(false);
    expect(bankingDetailsAreSet({ ...real, accountNumber: placeholder })).toBe(
      false,
    );
    expect(bankingDetailsAreSet({ ...real, bank: ' NOT SET YET ' })).toBe(
      false,
    );
  });

  it('is false for a blank detail', () => {
    expect(bankingDetailsAreSet({ ...real, branchCode: '  ' })).toBe(false);
  });
});

describe('createBookingSchema: where the appointment is (#115)', () => {
  it('needs an address when the appointment is at the client’s place', () => {
    const result = createBookingSchema.safeParse({
      ...valid,
      location: 'client',
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(['appointmentAddress']);
  });

  it('accepts and trims the address', () => {
    const result = createBookingSchema.parse({
      ...valid,
      location: 'client',
      appointmentAddress: '  12 Protea Road, Sunnyside, Pretoria ',
    });
    expect(result.appointmentAddress).toBe(
      '12 Protea Road, Sunnyside, Pretoria',
    );
  });

  it('refuses an address for an appointment at the owner’s place', () => {
    expect(
      createBookingSchema.safeParse({
        ...valid,
        location: 'studio',
        appointmentAddress: '12 Protea Road, Sunnyside',
      }).success,
    ).toBe(false);
  });

  it('refuses a place that is neither', () => {
    expect(
      createBookingSchema.safeParse({ ...valid, location: 'beach' }).success,
    ).toBe(false);
  });

  it('refuses an address that is too short or too long', () => {
    for (const appointmentAddress of ['x', 'y'.repeat(301)]) {
      expect(
        createBookingSchema.safeParse({
          ...valid,
          location: 'client',
          appointmentAddress,
        }).success,
      ).toBe(false);
    }
  });
});
