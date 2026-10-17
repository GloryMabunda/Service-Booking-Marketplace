import { BrevoEmailProvider, parseSender } from './brevo-email-provider.js';

const message = {
  to: 'client@gmail.com',
  subject: 'Hello',
  text: 'plain',
  html: '<p>html</p>',
};

describe('parseSender', () => {
  it('splits a name and an address', () => {
    expect(parseSender('Fresh Start <bookings@example.com>')).toEqual({
      name: 'Fresh Start',
      email: 'bookings@example.com',
    });
    expect(parseSender('"Fresh, Start" <b@example.com>')).toEqual({
      name: 'Fresh, Start',
      email: 'b@example.com',
    });
  });

  it('accepts a bare address', () => {
    expect(parseSender(' b@example.com ')).toEqual({ email: 'b@example.com' });
    expect(parseSender('<b@example.com>')).toEqual({ email: 'b@example.com' });
  });
});

describe('BrevoEmailProvider', () => {
  it("posts the email to Brevo's API with the key in a header", async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve(new Response('{"messageId":"x"}', { status: 201 })),
    );
    const provider = new BrevoEmailProvider(
      'secret-key',
      'Fresh Start <bookings@example.com>',
      fetchFn,
    );
    await provider.send({ ...message, replyTo: 'owner@example.com' });

    const [url, init] = fetchFn.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect((init.headers as Record<string, string>)['api-key']).toBe(
      'secret-key',
    );
    expect(JSON.parse(init.body as string)).toEqual({
      sender: { name: 'Fresh Start', email: 'bookings@example.com' },
      to: [{ email: 'client@gmail.com' }],
      subject: 'Hello',
      textContent: 'plain',
      htmlContent: '<p>html</p>',
      replyTo: { email: 'owner@example.com' },
    });
  });

  it("rejects with Brevo's reason, and never repeats the key", async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve(
        new Response('{"message":"Sender is not valid"}', { status: 400 }),
      ),
    );
    const provider = new BrevoEmailProvider(
      'secret-key',
      'b@example.com',
      fetchFn,
    );
    const failure = provider.send(message);
    await expect(failure).rejects.toThrow(
      'Brevo did not accept the email (400): Sender is not valid',
    );
    await expect(failure).rejects.not.toThrow(/secret-key/);
  });

  it('rejects when the answer is not JSON', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve(new Response('bad gateway', { status: 502 })),
    );
    const provider = new BrevoEmailProvider('k', 'b@example.com', fetchFn);
    await expect(provider.send(message)).rejects.toThrow(
      'Brevo did not accept the email (502)',
    );
  });
});
