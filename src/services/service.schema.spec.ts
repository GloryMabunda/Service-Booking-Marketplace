import {
  createServiceSchema,
  toService,
  updateServiceSchema,
} from './service.schema.js';

const problems = (
  schema: typeof createServiceSchema | typeof updateServiceSchema,
  body: unknown,
) => {
  const result = schema.safeParse(body);
  return result.success
    ? []
    : result.error.issues.map(
        (i) => `${i.path.join('.') || '(body)'}: ${i.message}`,
      );
};

describe('createServiceSchema', () => {
  it('accepts a service and fills in the optional fields', () => {
    expect(
      createServiceSchema.parse({
        name: '  Soft Glam ',
        price: '650',
        durationMinutes: 90,
      }),
    ).toEqual({
      name: 'Soft Glam',
      description: '',
      price: '650.00',
      durationMinutes: 90,
      isActive: true,
      availableForTravel: false,
    });
  });

  it('keeps a description and an inactive flag', () => {
    expect(
      createServiceSchema.parse({
        name: 'Bridal',
        description: ' Trial included. ',
        price: '2500.5',
        durationMinutes: 120,
        isActive: false,
      }),
    ).toMatchObject({
      description: 'Trial included.',
      price: '2500.50',
      isActive: false,
    });
  });

  it('names every missing required field', () => {
    expect(problems(createServiceSchema, {})).toEqual([
      'name: Enter the service name.',
      'price: Enter a price such as "650.00".',
      'durationMinutes: Enter the duration in minutes.',
    ]);
  });

  it.each([
    [{ name: '   ' }, 'name: Enter the service name.'],
    [
      { name: 'x'.repeat(101) },
      'name: The name must be at most 100 characters.',
    ],
    [
      { description: 'x'.repeat(2001) },
      'description: The description must be at most 2,000 characters.',
    ],
    [{ price: '-5.00' }, 'price: Enter a price such as "650.00".'],
    [{ price: '650.005' }, 'price: Enter a price such as "650.00".'],
    [{ price: 650 }, 'price: Enter a price such as "650.00".'],
    [{ price: '123456789.00' }, 'price: Enter a price such as "650.00".'],
    [
      { durationMinutes: 0 },
      'durationMinutes: The duration must be between 1 and 720 minutes.',
    ],
    [
      { durationMinutes: 721 },
      'durationMinutes: The duration must be between 1 and 720 minutes.',
    ],
    [
      { durationMinutes: 90.5 },
      'durationMinutes: Enter the duration in whole minutes.',
    ],
    [{ isActive: 'yes' }, 'isActive: Must be true or false.'],
  ])('rejects %j', (change, message) => {
    const base = { name: 'Soft Glam', price: '650.00', durationMinutes: 90 };
    expect(problems(createServiceSchema, { ...base, ...change })).toEqual([
      message,
    ]);
  });

  it('accepts a free service', () => {
    expect(
      createServiceSchema.parse({
        name: 'Consultation',
        price: '0',
        durationMinutes: 15,
      }).price,
    ).toBe('0.00');
  });

  it('rejects unknown fields', () => {
    expect(
      createServiceSchema.safeParse({
        name: 'Soft Glam',
        price: '650.00',
        durationMinutes: 90,
        colour: 'pink',
      }).success,
    ).toBe(false);
  });
});

describe('updateServiceSchema', () => {
  it('accepts any subset of the fields, without adding defaults', () => {
    expect(updateServiceSchema.parse({ price: '700' })).toEqual({
      price: '700.00',
    });
    expect(updateServiceSchema.parse({ isActive: false })).toEqual({
      isActive: false,
    });
  });

  it('applies the same rules as create', () => {
    expect(problems(updateServiceSchema, { durationMinutes: 0 })).toEqual([
      'durationMinutes: The duration must be between 1 and 720 minutes.',
    ]);
  });
});

describe('toService', () => {
  it('turns a database row into the API shape', () => {
    expect(
      toService(
        {
          id: '5b0d3c1e-0000-4000-8000-000000000001',
          name: 'Soft Glam',
          description: '',
          price: '650.00',
          duration_minutes: 90,
          is_active: true,
          available_for_travel: false,
          image_id: null,
          created_at: new Date('2026-10-13T08:00:00Z'),
          updated_at: new Date('2026-10-13T09:30:00Z'),
        },
        3,
      ),
    ).toEqual({
      id: '5b0d3c1e-0000-4000-8000-000000000001',
      name: 'Soft Glam',
      description: '',
      price: '650.00',
      durationMinutes: 90,
      isActive: true,
      availableForTravel: false,
      image: null,
      bookingCount: 3,
      createdAt: '2026-10-13T08:00:00Z',
      updatedAt: '2026-10-13T09:30:00Z',
    });
  });
});
