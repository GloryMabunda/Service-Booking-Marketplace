import { hashPassword, verifyPassword } from './password.js';

describe('password hashing', () => {
  it('stores an Argon2id hash, never the password itself', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain('correct horse battery staple');
  });

  it('accepts the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct horse battery staple');
    await expect(
      verifyPassword(hash, 'correct horse battery staple'),
    ).resolves.toBe(true);
    await expect(
      verifyPassword(hash, 'Correct horse battery staple'),
    ).resolves.toBe(false);
  });

  it('gives a different hash each time (random salt)', async () => {
    const [a, b] = await Promise.all([
      hashPassword('same password here'),
      hashPassword('same password here'),
    ]);
    expect(a).not.toBe(b);
  });

  it('treats a malformed hash as a wrong password instead of crashing', async () => {
    await expect(verifyPassword('not-a-hash', 'anything')).resolves.toBe(false);
  });
});
