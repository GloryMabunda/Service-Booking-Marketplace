import { isValidTimeZone, settingsPatchSchema } from './settings.schema.js';

const parse = (body: unknown) => settingsPatchSchema.safeParse(body);
const problems = (body: unknown) => {
  const result = parse(body);
  return result.success
    ? []
    : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
};

describe('settingsPatchSchema', () => {
  it('accepts an empty patch (nothing to change)', () => {
    expect(parse({})).toEqual({ success: true, data: {} });
  });

  it('accepts and tidies a full set of settings', () => {
    const result = parse({
      minNoticeHours: 12,
      maxAdvanceDays: 60,
      slotIntervalMinutes: 30,
      bufferMinutes: 15,
      depositPercent: '40',
      depositRefundable: false,
      refundCutoffHours: 48,
      depositHoldHours: 12,
      minPaymentWindowHours: 3,
      timeZone: 'Africa/Johannesburg',
      bankingDetails: {
        accountName: ' Make Up by Glory ',
        bank: 'Example Bank',
        accountNumber: '1234567890',
        branchCode: '250655',
        accountType: 'Cheque',
      },
      businessName: 'Make Up by Glory',
      businessEmail: ' Bookings@Example.com ',
      businessPhone: '082 123 4567',
    });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      depositPercent: '40.00',
      businessEmail: 'bookings@example.com',
      businessPhone: '+27821234567',
      bankingDetails: { accountName: 'Make Up by Glory' },
    });
  });

  it('allows the phone to be removed with null', () => {
    expect(parse({ businessPhone: null }).data).toEqual({
      businessPhone: null,
    });
  });

  it.each([
    [{ minNoticeHours: 721 }, 'minNoticeHours: Must be between 0 and 720.'],
    [{ minNoticeHours: 1.5 }, 'minNoticeHours: Enter a whole number.'],
    [{ maxAdvanceDays: 0 }, 'maxAdvanceDays: Must be between 1 and 365.'],
    [
      { slotIntervalMinutes: 32 },
      'slotIntervalMinutes: Must be a multiple of 5 minutes.',
    ],
    [
      { depositPercent: '100.01' },
      'depositPercent: Must be between 0 and 100.',
    ],
    [
      { depositPercent: 50 },
      'depositPercent: Enter a percentage such as "50.00".',
    ],
    [
      { timeZone: 'Mars/Olympus' },
      'timeZone: Enter a time zone such as Africa/Johannesburg.',
    ],
    [
      { businessPhone: '+44 20 7946 0958' },
      'businessPhone: Enter a South African phone number.',
    ],
    [{ businessEmail: 'nope' }, 'businessEmail: Enter a valid email address.'],
    [{ businessName: '  ' }, 'businessName: Enter the business name.'],
  ])('rejects %j', (body, message) => {
    expect(problems(body)).toEqual([message]);
  });

  it('needs all five banking details', () => {
    expect(problems({ bankingDetails: { bank: 'Example Bank' } })).toEqual([
      'bankingDetails.accountName: Enter the account name.',
      'bankingDetails.accountNumber: Enter the account number.',
      'bankingDetails.branchCode: Enter the branch code.',
      'bankingDetails.accountType: Enter the account type.',
    ]);
  });

  it('rejects unknown fields', () => {
    expect(parse({ colour: 'pink' }).success).toBe(false);
  });
});

describe('isValidTimeZone', () => {
  it.each(['Africa/Johannesburg', 'Europe/London', 'UTC'])('accepts %s', (tz) =>
    expect(isValidTimeZone(tz)).toBe(true),
  );
  it.each(['SAST', 'Johannesburg', 'Mars/Olympus', ''])('rejects %s', (tz) =>
    expect(isValidTimeZone(tz)).toBe(false),
  );
});
