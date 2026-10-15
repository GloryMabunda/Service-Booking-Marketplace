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

describe('TRUST_PROXY', () => {
  const base = {
    DATABASE_URL: 'postgres://booking:booking@localhost:5432/booking',
  };

  it('is unset by default: no proxy is believed', () => {
    expect(validateEnv(base).TRUST_PROXY).toBeUndefined();
    expect(
      validateEnv({ ...base, TRUST_PROXY: '' }).TRUST_PROXY,
    ).toBeUndefined();
  });

  it.each([
    ['0', 0],
    ['1', 1],
    ['2', 2],
    ['10', 10],
  ])('reads %s as a number of proxies', (text, expected) => {
    expect(validateEnv({ ...base, TRUST_PROXY: text }).TRUST_PROXY).toBe(
      expected,
    );
  });

  it.each(['11', '-1', '1.5', 'true', 'yes', '1,2', '100', ' 1x'])(
    'refuses %j, so the visitor address is never taken from the wrong place',
    (text) => {
      expect(() => validateEnv({ ...base, TRUST_PROXY: text })).toThrow(
        /TRUST_PROXY: must be a whole number from 0 to 10/,
      );
    },
  );
});

describe('production settings (#89)', () => {
  const production = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://booking:booking@db:5432/booking',
    SMTP_HOST: 'smtp.example.co.za',
    MAIL_FROM: 'Make Up by Glory <bookings@example.co.za>',
    PUBLIC_URL: 'https://bookings.example.co.za',
  };

  it('accepts a complete production setup', () => {
    expect(validateEnv(production).NODE_ENV).toBe('production');
  });

  it('refuses to start without an email provider, so no client is left without their emails', () => {
    expect(() => validateEnv({ ...production, SMTP_HOST: '' })).toThrow(
      /SMTP_HOST: is required in production/,
    );
  });

  it('refuses to start without the public address, which the links in emails need', () => {
    expect(() => validateEnv({ ...production, PUBLIC_URL: '' })).toThrow(
      /PUBLIC_URL: is required in production/,
    );
  });

  it('lists both when both are missing', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        DATABASE_URL: production.DATABASE_URL,
      }),
    ).toThrow(/SMTP_HOST[\s\S]*PUBLIC_URL/);
  });

  it('does not ask for them in development or tests', () => {
    for (const NODE_ENV of ['development', 'test']) {
      expect(() =>
        validateEnv({ NODE_ENV, DATABASE_URL: production.DATABASE_URL }),
      ).not.toThrow();
    }
  });
});
