import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
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
    const provider = createEmailProvider(config({ SMTP_PORT: 587 }));
    expect(provider).toBeInstanceOf(NoEmailProvider);
    await expect(
      provider.send({ to: 'a@b.com', subject: 's', text: 't', html: 'h' }),
    ).rejects.toThrow('SMTP_HOST is empty');
  });

  it('uses SMTP when SMTP_HOST is set', () => {
    const provider = createEmailProvider(
      config({
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: 587,
        MAIL_FROM: 'Make Up by Glory <bookings@example.com>',
      }),
    );
    expect(provider).toBeInstanceOf(SmtpEmailProvider);
  });
});
