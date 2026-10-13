import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import type { Env } from '../config/env.js';

// One email, ready to send: the same words as plain text and as HTML.
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
}

// How an email leaves the system. The notifications service only knows this
// interface, so tests use a fake and production uses SMTP (#54, #55).
// send() rejects when the provider doesn't accept the message.
export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');

// Used when no SMTP_HOST is set: every send fails with a clear reason, which
// is recorded on the notification, so a booking never claims an email that
// wasn't sent.
export class NoEmailProvider implements EmailProvider {
  send(): Promise<void> {
    return Promise.reject(
      new Error('No email provider is set up (SMTP_HOST is empty)'),
    );
  }
}

@Injectable()
export class SmtpEmailProvider implements EmailProvider {
  private readonly transport: Transporter;
  private readonly from: string;

  constructor(config: ConfigService<Env, true>) {
    const user = config.get('SMTP_USER', { infer: true });
    const pass = config.get('SMTP_PASSWORD', { infer: true });
    const port = config.get('SMTP_PORT', { infer: true });
    this.from = config.get('MAIL_FROM', { infer: true }) ?? '';
    this.transport = createTransport({
      host: config.get('SMTP_HOST', { infer: true }),
      port,
      // Port 465 is encrypted from the start; 587 upgrades with STARTTLS
      secure: port === 465,
      auth: user && pass ? { user, pass } : undefined,
      connectionTimeout: 10_000,
      socketTimeout: 15_000,
    });
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.from, ...message });
  }
}

export function createEmailProvider(
  config: ConfigService<Env, true>,
): EmailProvider {
  return config.get('SMTP_HOST', { infer: true })
    ? new SmtpEmailProvider(config)
    : new NoEmailProvider();
}
