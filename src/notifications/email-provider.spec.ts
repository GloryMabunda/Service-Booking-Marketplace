import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { DemoMailbox } from '../demo/demo-mailbox.js';
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
    ).rejects.toThrow('SMTP_HOST is empty');
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
        MAIL_FROM: 'Make Up by Glory <bookings@example.com>',
      }),
      new DemoMailbox(),
    );
    expect(provider).toBeInstanceOf(SmtpEmailProvider);
  });
});
