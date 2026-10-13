import {
  availabilityQuerySchema,
  blockedTimesQuerySchema,
  createBlockedTimeSchema,
  putAvailabilitySchema,
} from './availability.schema.js';

const problems = (
  schema: {
    safeParse: (b: unknown) => {
      success: boolean;
      error?: { issues: { path: PropertyKey[]; message: string }[] };
    };
  },
  body: unknown,
) => {
  const result = schema.safeParse(body);
  return result.success
    ? []
    : (result.error?.issues ?? []).map(
        (i) => `${i.path.join('.') || '(body)'}: ${i.message}`,
      );
};

// A valid week: Monday to Friday 09:00-17:00, weekend off
const week = () => ({
  days: [1, 2, 3, 4, 5]
    .map((dayOfWeek) => ({
      dayOfWeek,
      isWorkingDay: true,
      startTime: '09:00',
      endTime: '17:00',
    }))
    .concat(
      [6, 7].map((dayOfWeek) => ({
        dayOfWeek,
        isWorkingDay: false,
        startTime: null as unknown as string,
        endTime: null as unknown as string,
      })),
    ),
});

describe('putAvailabilitySchema (working hours)', () => {
  it('accepts a full week', () => {
    expect(putAvailabilitySchema.safeParse(week()).success).toBe(true);
  });

  it('needs exactly seven days', () => {
    const six = { days: week().days.slice(0, 6) };
    expect(problems(putAvailabilitySchema, six)).toEqual([
      'days: Send exactly seven days, Monday to Sunday.',
    ]);
    expect(problems(putAvailabilitySchema, {})).toEqual([
      'days: Send the whole week as a list of days.',
    ]);
  });

  it('needs each day of the week exactly once', () => {
    const body = week();
    body.days[6].dayOfWeek = 1;
    expect(problems(putAvailabilitySchema, body)).toEqual([
      'days.6.dayOfWeek: Each day of the week must appear exactly once.',
    ]);
  });

  it('puts the end time after the start time', () => {
    const body = week();
    body.days[2].endTime = '09:00';
    expect(problems(putAvailabilitySchema, body)).toEqual([
      'days.2.endTime: The end time must be after the start time.',
    ]);
    body.days[2].endTime = '08:00';
    expect(problems(putAvailabilitySchema, body)).toHaveLength(1);
  });

  it('needs both times on a working day', () => {
    const body = week();
    (body.days[0] as { startTime: string | null }).startTime = null;
    expect(problems(putAvailabilitySchema, body)).toEqual([
      'days.0.startTime: A working day needs a start and an end time.',
    ]);
  });

  it('gives a day off no hours', () => {
    const body = week();
    body.days[5].startTime = '09:00';
    expect(problems(putAvailabilitySchema, body)).toEqual([
      'days.5.startTime: A day off has no hours: use null.',
    ]);
  });

  it.each(['9:00', '24:00', '09:60', '0900', '09:00:00', 'nine'])(
    'rejects the time %j',
    (time) => {
      const body = week();
      body.days[0].startTime = time;
      expect(problems(putAvailabilitySchema, body)).toEqual([
        'days.0.startTime: Enter a time such as 09:00.',
      ]);
    },
  );

  it('rejects unknown fields', () => {
    expect(
      putAvailabilitySchema.safeParse({ ...week(), extra: 1 }).success,
    ).toBe(false);
  });
});

describe('createBlockedTimeSchema', () => {
  const valid = {
    startAt: '2026-11-05T22:00:00Z',
    endAt: '2026-11-06T22:00:00Z',
    reason: ' Wedding trial ',
  };

  it('accepts a blocked period and turns the times into dates', () => {
    const result = createBlockedTimeSchema.parse(valid);
    expect(result.startAt).toEqual(new Date('2026-11-05T22:00:00Z'));
    expect(result.endAt).toEqual(new Date('2026-11-06T22:00:00Z'));
    expect(result.reason).toBe('Wedding trial');
  });

  it('makes the reason optional', () => {
    const { startAt, endAt } = valid;
    expect(createBlockedTimeSchema.parse({ startAt, endAt }).reason).toBeNull();
  });

  it('puts the end after the start (#35)', () => {
    expect(
      problems(createBlockedTimeSchema, { ...valid, endAt: valid.startAt }),
    ).toEqual(['endAt: The end must be after the start.']);
    expect(
      problems(createBlockedTimeSchema, {
        ...valid,
        endAt: '2026-11-05T21:59:59Z',
      }),
    ).toEqual(['endAt: The end must be after the start.']);
  });

  it.each(['2026-11-05', '2026-11-05T22:00:00', 'tomorrow', ''])(
    'rejects the time %j',
    (startAt) => {
      expect(problems(createBlockedTimeSchema, { ...valid, startAt })).toEqual([
        'startAt: Enter the start as a UTC time such as 2026-11-05T22:00:00Z.',
      ]);
    },
  );

  it('limits the reason to 500 characters', () => {
    expect(
      problems(createBlockedTimeSchema, { ...valid, reason: 'x'.repeat(501) }),
    ).toEqual(['reason: The reason must be at most 500 characters.']);
  });
});

describe('query schemas', () => {
  it('blockedTimesQuerySchema takes optional real dates', () => {
    expect(blockedTimesQuerySchema.safeParse({}).success).toBe(true);
    expect(
      blockedTimesQuerySchema.safeParse({
        from: '2026-11-01',
        to: '2026-11-30',
      }).success,
    ).toBe(true);
    expect(problems(blockedTimesQuerySchema, { from: '2026-02-30' })).toEqual([
      'from: Enter a date such as 2026-11-03.',
    ]);
  });

  it('availabilityQuerySchema needs a service and a real date', () => {
    const serviceId = '5b0f6c3e-2f4a-4c55-9a43-3c1f5e2f8a10';
    expect(
      availabilityQuerySchema.safeParse({ serviceId, date: '2026-11-03' })
        .success,
    ).toBe(true);
    expect(problems(availabilityQuerySchema, {})).toEqual([
      'serviceId: Enter the service.',
      'date: Enter a date such as 2026-11-03.',
    ]);
    expect(
      problems(availabilityQuerySchema, {
        serviceId: 'nope',
        date: '2026-13-01',
      }),
    ).toEqual([
      'serviceId: Enter the service.',
      'date: Enter a date such as 2026-11-03.',
    ]);
  });
});
