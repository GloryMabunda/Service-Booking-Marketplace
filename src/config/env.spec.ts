import { validateEnv } from './env.js';

describe('validateEnv', () => {
  const valid = {
    DATABASE_URL: 'postgres://booking:booking@localhost:5432/booking',
  };

  it('applies defaults for optional settings', () => {
    expect(validateEnv(valid)).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      DATABASE_URL: valid.DATABASE_URL,
      SMTP_PORT: 587,
    });
  });

  it('turns PORT from text into a number', () => {
    expect(validateEnv({ ...valid, PORT: '8080' }).PORT).toBe(8080);
  });

  it('names a missing required variable and points to .env.example', () => {
    expect(() => validateEnv({})).toThrow(
      /DATABASE_URL: is required but not set[\s\S]*\.env\.example/,
    );
  });

  it('lists every problem at once', () => {
    let message = '';
    try {
      validateEnv({ DATABASE_URL: 'mysql://nope', PORT: '99999' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain(
      'DATABASE_URL: must be a postgres:// connection string',
    );
    expect(message).toContain(
      'PORT: must be a whole number between 1 and 65535',
    );
  });

  it('explains a PORT that is not a number', () => {
    expect(() => validateEnv({ ...valid, PORT: 'abc' })).toThrow(
      'PORT: must be a whole number between 1 and 65535',
    );
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => validateEnv({ ...valid, NODE_ENV: 'staging' })).toThrow(
      /NODE_ENV/,
    );
  });
});

describe('email settings', () => {
  const base = {
    DATABASE_URL: 'postgres://booking:booking@localhost:5432/booking',
  };

  it('are all optional, and blank values count as not set', () => {
    const env = validateEnv({ ...base, SMTP_HOST: '', MAIL_FROM: '  ' });
    expect(env.SMTP_HOST).toBeUndefined();
    expect(env.MAIL_FROM).toBeUndefined();
    expect(env.SMTP_PORT).toBe(587);
  });

  it('need MAIL_FROM once SMTP_HOST is set', () => {
    expect(() =>
      validateEnv({ ...base, SMTP_HOST: 'smtp.example.com' }),
    ).toThrow(/MAIL_FROM: is required when SMTP_HOST is set/);
    expect(
      validateEnv({
        ...base,
        SMTP_HOST: 'smtp.example.com',
        MAIL_FROM: 'bookings@example.com',
      }).SMTP_HOST,
    ).toBe('smtp.example.com');
  });

  it('check PUBLIC_URL is a web address', () => {
    expect(() => validateEnv({ ...base, PUBLIC_URL: 'not a url' })).toThrow(
      /PUBLIC_URL/,
    );
    expect(
      validateEnv({ ...base, PUBLIC_URL: 'https://example.com' }).PUBLIC_URL,
    ).toBe('https://example.com');
  });
});
