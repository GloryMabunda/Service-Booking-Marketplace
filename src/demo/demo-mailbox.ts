import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type {
  EmailMessage,
  EmailProvider,
} from '../notifications/email-provider.js';

// In demo mode (DEMO_MODE=true) no email is really sent. Each one is kept here
// instead, newest first, and shown on the demo mailbox page, so someone trying
// the demo can open the booking link and payment instructions that would have
// gone to a client. Kept in memory only: a restart empties it.

export interface DemoEmail {
  id: string;
  to: string;
  subject: string;
  text: string;
  sentAt: string;
}

const KEEP = 50;

@Injectable()
export class DemoMailbox implements EmailProvider {
  private emails: DemoEmail[] = [];

  send(message: EmailMessage): Promise<void> {
    this.emails.unshift({
      id: randomUUID(),
      to: message.to,
      subject: message.subject,
      text: message.text,
      sentAt: new Date().toISOString(),
    });
    this.emails.length = Math.min(this.emails.length, KEEP);
    return Promise.resolve();
  }

  list(): DemoEmail[] {
    return [...this.emails];
  }

  clear(): void {
    this.emails = [];
  }
}
