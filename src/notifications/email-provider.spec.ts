import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { DemoMailbox } from '../demo/demo-mailbox.js';
import { DemoRealEmailProvider } from '../demo/demo-real-email.js';
import { BrevoEmailProvider } from './brevo-email-provider.js';
import {
  NoEmailProvider,
  SmtpEmailProvider,
  createEmailProvider,
} from './email-provider.js';

const config = (values: Partial<Env>) =>
  ({
    get: (key: keyof Env) => values[key],
  }) as unknown as ConfigService<Env, true>;

describe('createEmailProvider', () => {
  it('sends nothing when SMTP_HOST is not set, and says why', async () => {
    const provider = createEmailProvider(
      config({ SMTP_PORT: 587 }),
      new DemoMailbox(),
    );
    expect(provider).toBeInstanceOf(NoEmailProvider);
    await expect(
      provider.send({ to: 'a@b.com', subject: 's', text: 't', html: 'h' }),
    ).rejects.toThrow('SMTP_HOST and BREVO_API_KEY are empty');
  });

  it('keeps emails on the demo mailbox, and sends none, in demo mode', async () => {
    const mailbox = new DemoMailbox();
    const provider = createEmailProvider(
      config({ DEMO_MODE: true, SMTP_PORT: 587 }),
      mailbox,
    );
    expect(provider).toBe(mailbox);
    await provider.send({ to: 'a@b.com', subject: 's', text: 't', html: 'h' });
    expect(mailbox.list()).toHaveLength(1);
  });

  it('uses SMTP when SMTP_HOST is set', () => {
    const provider = createEmailProvider(
      config({
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: 587,
        MAIL_FROM: 'Fresh Start <bookings@example.com>',
      }),
      new DemoMailbox(),
    );
    expect(provider).toBeInstanceOf(SmtpEmailProvider);
  });
});

describe('createEmailProvider with Brevo', () => {
  const brevo = {
    BREVO_API_KEY: 'k',
    MAIL_FROM: 'Fresh Start <bookings@example.com>',
    SMTP_PORT: 587,
  };

  it('uses Brevo when its key is set', () => {
    expect(
      createEmailProvider(config(brevo), new DemoMailbox()),
    ).toBeInstanceOf(BrevoEmailProvider);
  });

  it('keeps the demo on the mailbox unless real email is switched on', () => {
    const mailbox = new DemoMailbox();
    expect(
      createEmailProvider(config({ ...brevo, DEMO_MODE: true }), mailbox),
    ).toBe(mailbox);
  });

  it('adds limited real email to the demo when switched on', () => {
    const provider = createEmailProvider(
      config({
        ...brevo,
        DEMO_MODE: true,
        DEMO_REAL_EMAIL: true,
        DEMO_REAL_EMAIL_DAILY_CAP: 100,
        DEMO_REAL_EMAIL_PER_ADDRESS_PER_HOUR: 3,
      }),
      new DemoMailbox(),
    );
    expect(provider).toBeInstanceOf(DemoRealEmailProvider);
  });
});
