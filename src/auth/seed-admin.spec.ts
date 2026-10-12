import { parseAdminSeedEnv } from './seed-admin.js';

describe('parseAdminSeedEnv', () => {
  it('accepts a valid email and a long enough password', () => {
    expect(
      parseAdminSeedEnv({
        ADMIN_EMAIL: ' owner@example.com ',
        ADMIN_PASSWORD: 'a-long-password',
      }),
    ).toEqual({ email: 'owner@example.com', password: 'a-long-password' });
  });

  it('names both missing variables', () => {
    expect(() => parseAdminSeedEnv({})).toThrow(
      /ADMIN_EMAIL: is required[\s\S]*ADMIN_PASSWORD: is required/,
    );
  });

  it('rejects an invalid email', () => {
    expect(() =>
      parseAdminSeedEnv({
        ADMIN_EMAIL: 'not-an-email',
        ADMIN_PASSWORD: 'a-long-password',
      }),
    ).toThrow(/ADMIN_EMAIL: must be a valid email address/);
  });

  it('rejects a password shorter than 12 characters', () => {
    expect(() =>
      parseAdminSeedEnv({
        ADMIN_EMAIL: 'owner@example.com',
        ADMIN_PASSWORD: 'short',
      }),
    ).toThrow(/ADMIN_PASSWORD: must be at least 12 characters/);
  });

  it('never repeats the password in an error', () => {
    expect(() =>
      parseAdminSeedEnv({
        ADMIN_EMAIL: 'bad',
        ADMIN_PASSWORD: 'secret-ish',
      }),
    ).toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining('secret-ish') as string,
      }),
    );
  });
});
