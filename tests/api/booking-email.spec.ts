import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Kysely, Selectable } from 'kysely';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { configureApp } from '../../src/app.factory.js';
import { AppModule } from '../../src/app.module.js';
import {
  RATE_LIMITER,
  type SlidingWindowLimiter,
} from '../../src/common/rate-limit.js';
import type { DB } from '../../src/database/database.types.js';
import {
  EMAIL_PROVIDER,
  type EmailMessage,
  type EmailProvider,
} from '../../src/notifications/email-provider.js';
import { createTestDatabase } from '../helpers/database.js';
import { localAt, upcoming } from '../helpers/dates.js';
import { bodyOf } from '../helpers/http.js';
import type { CreatedBooking } from '../../src/bookings/bookings.service.js';

// The payment instructions email that goes out with a new booking (#54, #56).

class FakeEmailProvider implements EmailProvider {
  sent: EmailMessage[] = [];
  failWith: string | null = null;
  send(message: EmailMessage): Promise<void> {
    if (this.failWith) return Promise.reject(new Error(this.failWith));
    this.sent.push(message);
    return Promise.resolve();
  }
}

const PREFIX = 'Booking email test ';
const BANKING = {
  accountName: 'Make Up by Glory',
  bank: 'Example Bank',
  accountNumber: '1234567890',
  branchCode: '250655',
  accountType: 'Cheque',
};
const person = {
  clientName: 'Sarah Mokoena',
  clientEmail: 'sarah.email-test@example.com',
  clientPhone: '082 555 1234',
};

describe('Booking emails', () => {
  let db: Kysely<DB>;
  let app: INestApplication<App>;
  let provider: FakeEmailProvider;
  let service: { id: string };
  let originalSettings: Selectable<DB['settings']>;

  beforeAll(async () => {
    db = createTestDatabase();
    originalSettings = await db
      .selectFrom('settings')
      .selectAll()
      .executeTakeFirstOrThrow();
    await db
      .updateTable('settings')
      .set({ banking_details: JSON.stringify(BANKING) })
      .where('id', '=', 1)
      .execute();
    provider = new FakeEmailProvider();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_PROVIDER)
      .useValue(provider)
      .compile();
    app = moduleRef.createNestApplication<INestApplication<App>>({
      logger: false,
    });
    configureApp(app);
    await app.init();
    service = await db
      .insertInto('services')
      .values({
        name: `${PREFIX}Soft Glam`,
        price: '650.00',
        duration_minutes: 90,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
  });

  beforeEach(() => {
    app.get<SlidingWindowLimiter>(RATE_LIMITER).reset();
    provider.sent = [];
    provider.failWith = null;
  });

  afterEach(() => clean(db, service.id));

  afterAll(async () => {
    await clean(db, service.id);
    await db
      .updateTable('settings')
      .set({
        ...originalSettings,
        banking_details: JSON.stringify(originalSettings.banking_details),
      })
      .where('id', '=', 1)
      .execute();
    await db
      .deleteFrom('services')
      .where('name', 'like', `${PREFIX}%`)
      .execute();
    await app.close();
    await db.destroy();
  });

  const book = () =>
    request(app.getHttpServer())
      .post('/api/bookings')
      .send({
        serviceId: service.id,
        startAt: localAt(upcoming(2), '09:00'),
        ...person,
      });

  it('emails the payment instructions and says so in the response', async () => {
    const res = await book();
    expect(res.status).toBe(201);
    expect(bodyOf<CreatedBooking>(res).emailSentTo).toBe(person.clientEmail);

    expect(provider.sent).toHaveLength(1);
    const email = provider.sent[0];
    const reference = bodyOf<CreatedBooking>(res).booking.reference;
    expect(email.to).toBe(person.clientEmail);
    expect(email.subject).toBe(
      `Your booking request ${reference}: please pay your deposit`,
    );
    for (const body of [email.text, email.html]) {
      // Banking details, the reference as the EFT reference, the amounts
      expect(body).toContain('1234567890');
      expect(body).toContain('250655');
      expect(body).toContain(reference);
      expect(body).toContain('R325');
      expect(body).toContain('Soft Glam');
      expect(body).toContain('not confirmed yet');
      expect(body).toContain('only once your deposit reflects');
    }
    expect(email.text).toContain(`Reference:       ${reference}`);
  });

  it('puts the booking link in this email only, and only its hash in the database', async () => {
    const res = await book();
    const email = provider.sent[0];
    const link = /http\S*\/booking\/([\w-]+)/.exec(email.text);
    expect(link).not.toBeNull();
    const token = link?.[1] ?? '';
    expect(token).toHaveLength(43); // 32 bytes, base64url

    // The response, the notification history and the database never hold it
    expect(JSON.stringify(res.body)).not.toContain(token);
    const notification = await db
      .selectFrom('notifications')
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(JSON.stringify(notification)).not.toContain(token);
    const stored = await db
      .selectFrom('bookings')
      .select('booking_token_hash')
      .where('reference', '=', bodyOf<CreatedBooking>(res).booking.reference)
      .executeTakeFirstOrThrow();
    expect(stored.booking_token_hash).toEqual(
      createHash('sha256').update(token).digest(),
    );
    // The HTML button uses the same link
    expect(email.html).toContain(`/booking/${token}`);
  });

  it('records the send on the notification', async () => {
    await book();
    const rows = await db.selectFrom('notifications').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: 'payment_instructions',
      channel: 'email',
      recipient: person.clientEmail,
      status: 'sent',
      error: null,
    });
    expect(rows[0]?.sent_at).not.toBeNull();
  });

  it('keeps the booking, records the failure and says no email was sent', async () => {
    provider.failWith = 'the mail server is down';
    const res = await book();
    expect(res.status).toBe(201);
    expect(bodyOf<CreatedBooking>(res).emailSentTo).toBeNull();

    const booking = await db
      .selectFrom('bookings')
      .select('status')
      .where('reference', '=', bodyOf<CreatedBooking>(res).booking.reference)
      .executeTakeFirst();
    expect(booking?.status).toBe('pending');
    const rows = await db.selectFrom('notifications').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'failed',
      error: 'the mail server is down',
      sent_at: null,
    });
  });
});

async function clean(db: Kysely<DB>, serviceId: string) {
  // Notifications keep their booking (RESTRICT), so they go first
  await db
    .deleteFrom('notifications')
    .where(
      'booking_id',
      'in',
      db
        .selectFrom('bookings')
        .select('id')
        .where('service_id', '=', serviceId),
    )
    .execute();
  await db.deleteFrom('bookings').where('service_id', '=', serviceId).execute();
}
