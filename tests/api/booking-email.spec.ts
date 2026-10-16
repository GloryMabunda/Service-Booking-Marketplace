import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Kysely, Selectable } from 'kysely';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { configureApp } from '../../src/app.factory.js';
import { AppModule } from '../../src/app.module.js';
import { BookingExpiryService } from '../../src/bookings/booking-expiry.service.js';
import type { CreatedBooking } from '../../src/bookings/bookings.service.js';
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

// The emails around a booking: payment instructions (#56), the confirmation
// when no deposit is needed (#57), a new booking link (#58), the owner's
// notice (#60), the expiry notice (#59) and a provider that fails (#61).

class FakeEmailProvider implements EmailProvider {
  sent: EmailMessage[] = [];
  failWith: string | null = null;
  // Fail only for emails to this address
  failFor: string | null = null;
  send(message: EmailMessage): Promise<void> {
    if (this.failWith && (!this.failFor || this.failFor === message.to)) {
      return Promise.reject(new Error(this.failWith));
    }
    this.sent.push(message);
    return Promise.resolve();
  }
}

const PREFIX = 'Booking email test ';
const BANKING = {
  accountName: 'Fresh Start Home Services',
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
const TOKEN_IN_LINK = /http\S*\/booking\/([\w-]+)/;
const sha256 = (text: string) => createHash('sha256').update(text).digest();

describe('Booking emails', () => {
  let db: Kysely<DB>;
  let app: INestApplication<App>;
  let provider: FakeEmailProvider;
  let service: { id: string };
  let originalSettings: Selectable<DB['settings']>;
  let ownerEmail: string;

  beforeAll(async () => {
    db = createTestDatabase();
    originalSettings = await db
      .selectFrom('settings')
      .selectAll()
      .executeTakeFirstOrThrow();
    ownerEmail = originalSettings.business_email;
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
        name: `${PREFIX}Standard Clean`,
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
    provider.failFor = null;
  });

  afterEach(async () => {
    await clean(db, service.id);
    await db
      .updateTable('settings')
      .set({ deposit_percent: originalSettings.deposit_percent })
      .where('id', '=', 1)
      .execute();
  });

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

  const book = (time = '09:00') =>
    request(app.getHttpServer())
      .post('/api/bookings')
      .send({
        serviceId: service.id,
        startAt: localAt(upcoming(2), time),
        ...person,
      });
  const toClient = () =>
    provider.sent.filter((m) => m.to === person.clientEmail);
  const toOwner = () => provider.sent.filter((m) => m.to === ownerEmail);
  const reference = (res: request.Response) =>
    bodyOf<CreatedBooking>(res).booking.reference;
  const hashOf = async (ref: string) =>
    (
      await db
        .selectFrom('bookings')
        .select('booking_token_hash')
        .where('reference', '=', ref)
        .executeTakeFirstOrThrow()
    ).booking_token_hash;
  const resend = (ref: string, email: string) =>
    request(app.getHttpServer())
      .post(`/api/bookings/${ref}/resend-booking-link`)
      .send({ email });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 150));
  const noDeposit = () =>
    db
      .updateTable('settings')
      .set({ deposit_percent: '0' })
      .where('id', '=', 1)
      .execute();

  describe('payment instructions (#56)', () => {
    it('are emailed and the response says so', async () => {
      const res = await book();
      expect(res.status).toBe(201);
      expect(bodyOf<CreatedBooking>(res).emailSentTo).toBe(person.clientEmail);

      expect(toClient()).toHaveLength(1);
      const email = toClient()[0];
      const ref = reference(res);
      expect(email.subject).toBe(
        `Your booking request ${ref}: please pay your deposit`,
      );
      for (const body of [email.text, email.html]) {
        expect(body).toContain('1234567890');
        expect(body).toContain('250655');
        expect(body).toContain(ref);
        expect(body).toContain('R325');
        expect(body).toContain('Standard Clean');
        expect(body).toContain('not confirmed yet');
        expect(body).toContain('only once your deposit reflects');
      }
      expect(email.text).toContain(`Reference:       ${ref}`);
    });

    it('hold the booking link, and only its hash is in the database', async () => {
      const res = await book();
      const email = toClient()[0];
      const link = TOKEN_IN_LINK.exec(email.text);
      expect(link).not.toBeNull();
      const token = link?.[1] ?? '';
      expect(token).toHaveLength(43); // 32 bytes, base64url

      expect(JSON.stringify(res.body)).not.toContain(token);
      const notifications = await db
        .selectFrom('notifications')
        .selectAll()
        .execute();
      expect(JSON.stringify(notifications)).not.toContain(token);
      expect(await hashOf(reference(res))).toEqual(sha256(token));
      expect(email.html).toContain(`/booking/${token}`);
    });

    it('are recorded on the notification', async () => {
      await book();
      const row = await db
        .selectFrom('notifications')
        .selectAll()
        .where('type', '=', 'payment_instructions')
        .executeTakeFirstOrThrow();
      expect(row).toMatchObject({
        channel: 'email',
        recipient: person.clientEmail,
        status: 'sent',
        error: null,
      });
      expect(row.sent_at).not.toBeNull();
    });
  });

  describe('confirmation when no deposit is needed (#57)', () => {
    it('is sent instead of the payment instructions', async () => {
      await noDeposit();
      const res = await book();
      expect(res.status).toBe(201);
      expect(bodyOf<CreatedBooking>(res).booking.status).toBe('confirmed');
      expect(bodyOf<CreatedBooking>(res).emailSentTo).toBe(person.clientEmail);

      expect(toClient()).toHaveLength(1);
      const email = toClient()[0];
      expect(email.subject).toMatch(/^You're booked! .*Standard Clean on /);
      expect(email.text).toContain('Your booking is confirmed.');
      expect(email.text).not.toMatch(/deposit/i);
      const token = TOKEN_IN_LINK.exec(email.text)?.[1] ?? '';
      expect(await hashOf(reference(res))).toEqual(sha256(token));

      const types = (
        await db.selectFrom('notifications').select('type').execute()
      ).map((n) => n.type);
      expect(types).toContain('booking_confirmed');
      expect(types).not.toContain('payment_instructions');
    });
  });

  describe('the owner’s notice (#60)', () => {
    it('is sent for every booking with the reference, client, service, time and deposit', async () => {
      const res = await book();
      expect(toOwner()).toHaveLength(1);
      const email = toOwner()[0];
      expect(email.subject).toMatch(
        /^New booking: Sarah Mokoena, .*Standard Clean, /,
      );
      for (const part of [
        reference(res),
        'Sarah Mokoena',
        person.clientEmail,
        '+27825551234',
        'Standard Clean',
        'R325',
        'Pending (awaiting deposit)',
      ]) {
        expect(email.text).toContain(part);
      }
      // Never the client's booking link
      expect(email.text).not.toMatch(/\/booking\/[\w-]{43}/);
      expect(email.html).not.toMatch(/\/booking\/[\w-]{43}/);
    });

    it('says Confirmed (no deposit) when no deposit is needed', async () => {
      await noDeposit();
      await book();
      const text = toOwner()[0].text;
      expect(text).toContain('Confirmed (no deposit)');
      expect(text).not.toContain('Deposit:');
    });

    it('is recorded as admin_new_booking', async () => {
      await book();
      const row = await db
        .selectFrom('notifications')
        .selectAll()
        .where('type', '=', 'admin_new_booking')
        .executeTakeFirstOrThrow();
      expect(row).toMatchObject({ recipient: ownerEmail, status: 'sent' });
    });
  });

  describe('a provider that fails (#61)', () => {
    it('keeps the booking, records the failures and says no email was sent', async () => {
      provider.failWith = 'the mail server is down';
      const res = await book();
      expect(res.status).toBe(201);
      expect(bodyOf<CreatedBooking>(res).emailSentTo).toBeNull();

      const booking = await db
        .selectFrom('bookings')
        .select('status')
        .where('reference', '=', reference(res))
        .executeTakeFirstOrThrow();
      expect(booking.status).toBe('pending');
      const rows = await db.selectFrom('notifications').selectAll().execute();
      expect(rows).toHaveLength(2); // the client's and the owner's
      for (const row of rows) {
        expect(row).toMatchObject({
          status: 'failed',
          error: 'the mail server is down',
          sent_at: null,
        });
      }
    });

    it('still emails the client when only the owner’s email fails', async () => {
      provider.failWith = 'mailbox full';
      provider.failFor = ownerEmail;
      const res = await book();
      expect(res.status).toBe(201);
      expect(bodyOf<CreatedBooking>(res).emailSentTo).toBe(person.clientEmail);
      expect(toClient()).toHaveLength(1);
    });
  });

  describe('expired bookings (#59)', () => {
    const backdate = (ref: string) =>
      db
        .updateTable('bookings')
        .set({ deposit_due_at: new Date(Date.now() - 60_000) })
        .where('reference', '=', ref)
        .execute();

    it('tell the client the time has been released', async () => {
      const ref = reference(await book());
      provider.sent = [];
      await backdate(ref);

      const expired = await app
        .get(BookingExpiryService)
        .expireAndNotify(new Date());
      expect(expired.map((b) => b.reference)).toEqual([ref]);

      expect(toClient()).toHaveLength(1);
      const email = toClient()[0];
      expect(email.subject).toBe(`Your booking request ${ref} has expired`);
      expect(email.text).toContain('the booking has expired');
      expect(email.text).toContain('Standard Clean');
      // The expiry email carries no booking link (BR-15)
      expect(email.text).not.toMatch(/\/booking\/[\w-]{43}/);
      const row = await db
        .selectFrom('notifications')
        .selectAll()
        .where('type', '=', 'booking_expired')
        .executeTakeFirstOrThrow();
      expect(row.status).toBe('sent');
    });

    it('stay expired when the email cannot be sent', async () => {
      const ref = reference(await book());
      await backdate(ref);
      provider.failWith = 'the mail server is down';
      await app.get(BookingExpiryService).expireAndNotify(new Date());
      const booking = await db
        .selectFrom('bookings')
        .select('status')
        .where('reference', '=', ref)
        .executeTakeFirstOrThrow();
      expect(booking.status).toBe('expired');
    });
  });

  describe('a new booking link (#58)', () => {
    const MESSAGE =
      'If the details match an active booking, a new booking link has been sent to its email address.';

    it('replaces the old link and emails the new one to the booking’s address', async () => {
      const ref = reference(await book());
      const oldToken = TOKEN_IN_LINK.exec(toClient()[0].text)?.[1] ?? '';
      provider.sent = [];

      const res = await resend(ref, person.clientEmail.toUpperCase());
      expect(res.status).toBe(202);
      expect(res.body).toEqual({ message: MESSAGE });
      await vi.waitFor(() => expect(toClient()).toHaveLength(1));

      const email = toClient()[0];
      expect(email.subject).toBe(`Your new booking link for ${ref}`);
      expect(email.text).toContain('Your previous link no longer works.');
      const newToken = TOKEN_IN_LINK.exec(email.text)?.[1] ?? '';
      expect(newToken).not.toBe(oldToken);
      // Only the new link works: the database holds the new hash alone
      expect(await hashOf(ref)).toEqual(sha256(newToken));
      expect(await hashOf(ref)).not.toEqual(sha256(oldToken));
      expect(JSON.stringify(res.body)).not.toContain(newToken);
    });

    it('sends a confirmed booking the confirmation wording', async () => {
      await noDeposit();
      const ref = reference(await book());
      provider.sent = [];
      await resend(ref, person.clientEmail);
      await vi.waitFor(() => expect(toClient()).toHaveLength(1));
      expect(toClient()[0].subject).toBe(`Your new booking link for ${ref}`);
      expect(toClient()[0].text).toContain(
        'Your previous link no longer works.',
      );
    });

    it('answers the same and sends nothing for a wrong email or an unknown reference', async () => {
      const ref = reference(await book());
      const before = await hashOf(ref);
      provider.sent = [];

      const wrongEmail = await resend(ref, 'someone.else@example.com');
      const unknown = await resend('BK-999999', person.clientEmail);
      const malformed = await resend('nonsense', person.clientEmail);
      for (const res of [wrongEmail, unknown, malformed]) {
        expect(res.status).toBe(202);
        expect(res.body).toEqual({ message: MESSAGE });
      }
      await settle();
      expect(provider.sent).toHaveLength(0);
      expect(await hashOf(ref)).toEqual(before);
    });

    it('does nothing for an expired booking', async () => {
      const ref = reference(await book());
      await db
        .updateTable('bookings')
        .set({ status: 'expired' })
        .where('reference', '=', ref)
        .execute();
      const before = await hashOf(ref);
      provider.sent = [];
      const res = await resend(ref, person.clientEmail);
      expect(res.status).toBe(202);
      await settle();
      expect(provider.sent).toHaveLength(0);
      expect(await hashOf(ref)).toEqual(before);
    });

    it('allows 3 new links an hour for one booking, then 429', async () => {
      const ref = reference(await book());
      for (let i = 0; i < 3; i++) {
        expect((await resend(ref, person.clientEmail)).status).toBe(202);
      }
      const fourth = await resend(ref, person.clientEmail);
      expect(fourth.status).toBe(429);
      expect(fourth.headers['retry-after']).toBeDefined();
    });

    it('counts a made-up reference too, so the limit tells nothing', async () => {
      for (let i = 0; i < 3; i++) {
        await resend('BK-999999', person.clientEmail);
      }
      expect((await resend('BK-999999', person.clientEmail)).status).toBe(429);
    });

    it('limits one IP address to 10 an hour', async () => {
      for (let i = 0; i < 10; i++) {
        const res = await resend(`BK-9000${i}0`, 'a@example.com');
        expect(res.status).toBe(202);
      }
      expect((await resend('BK-900099', 'a@example.com')).status).toBe(429);
    });

    it('asks for a valid email', async () => {
      const res = await resend('BK-000123', 'not an email');
      expect(res.status).toBe(400);
    });

    it('still answers 202 when the email cannot be sent', async () => {
      const ref = reference(await book());
      provider.failWith = 'the mail server is down';
      const res = await resend(ref, person.clientEmail);
      expect(res.status).toBe(202);
      // The email is sent in the background: wait until its failure is recorded
      await vi.waitFor(async () => {
        const failed = await db
          .selectFrom('notifications')
          .select('id')
          .where('status', '=', 'failed')
          .execute();
        expect(failed.length).toBeGreaterThan(0);
      });
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
