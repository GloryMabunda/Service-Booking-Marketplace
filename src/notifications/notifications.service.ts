import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { DATABASE } from '../database/database.module.js';
import type { DB, NotificationType } from '../database/database.types.js';
import { EMAIL_PROVIDER, type EmailProvider } from './email-provider.js';
import type { RenderedEmail } from './payment-instructions.template.js';

export interface EmailToSend {
  bookingId: string;
  type: NotificationType;
  to: string;
  email: RenderedEmail;
  replyTo?: string;
}

// Sends emails and records every attempt in the notifications table (#54):
// a row is saved as pending before the send, then marked sent or failed with
// the provider's reason. A failure is never thrown: it must not block or undo
// a booking (spec section 7, #61).
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    @Inject(EMAIL_PROVIDER) private readonly provider: EmailProvider,
  ) {}

  // Returns true when the provider accepted the email.
  async sendEmail(item: EmailToSend): Promise<boolean> {
    let id: string | null = null;
    try {
      const row = await this.db
        .insertInto('notifications')
        .values({
          booking_id: item.bookingId,
          channel: 'email',
          recipient: item.to,
          type: item.type,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      id = row.id;
    } catch (error) {
      // Not being able to record the attempt still shouldn't stop the email
      this.logger.error(
        `Could not record a ${item.type} email: ${describe(error)}`,
      );
    }

    try {
      await this.provider.send({
        to: item.to,
        subject: item.email.subject,
        text: item.email.text,
        html: item.email.html,
        replyTo: item.replyTo,
      });
    } catch (error) {
      this.logger.error(`A ${item.type} email failed: ${describe(error)}`);
      await this.record(id, 'failed', describe(error));
      return false;
    }
    await this.record(id, 'sent', null);
    return true;
  }

  private async record(
    id: string | null,
    status: 'sent' | 'failed',
    error: string | null,
  ): Promise<void> {
    if (!id) return;
    try {
      await this.db
        .updateTable('notifications')
        .set({
          status,
          error,
          sent_at: status === 'sent' ? new Date() : null,
        })
        .where('id', '=', id)
        .execute();
    } catch (cause) {
      this.logger.error(
        `Could not update notification ${id}: ${describe(cause)}`,
      );
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
