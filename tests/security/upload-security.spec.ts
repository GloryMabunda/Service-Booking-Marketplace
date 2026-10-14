import { createHash } from 'node:crypto';
import { newStorageKey } from '../../src/storage/file-storage.js';
import { PublicBookingService } from '../../src/bookings/public-booking.service.js';
import { startHarness, type Harness } from '../helpers/harness.js';
import { errorBody } from '../helpers/http.js';

// Proof-of-payment uploads can't be abused (section 10, BR-14, #78): what a
// file is comes from its bytes, size and count limits hold, only a Pending
// booking takes a proof, proofs are unreachable without an admin session, a
// client can't touch another client's booking, and parallel uploads never get
// past the limit of 3.

const PDF = Buffer.from('%PDF-1.4\n%proof\n');
const MB = 1024 * 1024;

describe('Proof upload security', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness('upsec');
  });
  beforeEach(() => h.reset());
  afterEach(async () => {
    const mine = h.db
      .selectFrom('bookings')
      .select('id')
      .where('service_id', '=', h.service.id);
    await h.db
      .deleteFrom('notifications')
      .where('booking_id', 'in', mine)
      .execute();
    await h.db
      .deleteFrom('payment_proofs')
      .where('booking_id', 'in', mine)
      .execute();
    await h.db
      .deleteFrom('bookings')
      .where('service_id', '=', h.service.id)
      .execute();
  });
  afterAll(() => h.close());

  const upload = (
    token: string,
    file: Buffer = PDF,
    filename = 'proof.pdf',
    contentType = 'application/pdf',
  ) =>
    h
      .http()
      .post(`/api/booking/${token}/proofs`)
      .attach('file', file, { filename, contentType });
  const proofsOf = (id: string) =>
    h.db
      .selectFrom('payment_proofs')
      .selectAll()
      .where('booking_id', '=', id)
      .execute();
  const stored = () => h.storage.list('private');

  describe('what a file is comes from its content, not its name', () => {
    const impostors: [string, Buffer][] = [
      [
        'an HTML page',
        Buffer.from('<html><script>alert(document.cookie)</script></html>'),
      ],
      [
        'an SVG',
        Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
        ),
      ],
      [
        'a Windows program',
        Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200)]),
      ],
      ['a shell script', Buffer.from('#!/bin/sh\nrm -rf /\n')],
      ['a ZIP archive', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])],
      ['a GIF', Buffer.from('GIF89a\x01\x00\x01\x00')],
      ['plain text', Buffer.from('this is not a payment')],
      [
        'a PDF signature that does not start the file',
        Buffer.from('\n%PDF-1.4'),
      ],
      ['a truncated JPEG signature', Buffer.from([0xff, 0xd8])],
      ['an empty file', Buffer.alloc(0)],
    ];

    it.each(impostors)('refuses %s named proof.pdf', async (_name, data) => {
      const { booking, token } = await h.makeBooking();
      const res = await upload(token, data, 'proof.pdf', 'application/pdf');
      expect(res.status).toBe(data.length === 0 ? 400 : 415);
      expect(await proofsOf(booking.id)).toHaveLength(0);
      expect(await stored()).toHaveLength(0);
    });

    it.each(['proof.png', 'proof.jpg', 'proof.jpeg', 'proof.PDF', 'proof'])(
      'refuses HTML whatever it is called (%s) or claims to be',
      async (filename) => {
        const { token } = await h.makeBooking();
        for (const claimed of [
          'image/png',
          'image/jpeg',
          'application/pdf',
          'text/html',
        ]) {
          await h.reset();
          const res = await upload(
            token,
            Buffer.from('<html>hi</html>'),
            filename,
            claimed,
          );
          expect(res.status, `${filename} ${claimed}`).toBe(415);
        }
      },
    );

    it('accepts a real PDF however it is named, and never uses the name as a path', async () => {
      const { booking, token } = await h.makeBooking();
      const res = await upload(
        token,
        PDF,
        '../../../etc/cron.d/evil.exe',
        'text/plain',
      );
      expect(res.status).toBe(201);
      const [proof] = await proofsOf(booking.id);
      expect(proof.content_type).toBe('application/pdf');
      expect(proof.original_filename).toBe('evil.exe');
      expect(proof.storage_key).toMatch(/^[a-f0-9]{64}$/);
      expect(await stored()).toEqual([proof.storage_key]);
    });

    it('keeps the bytes exactly as they were sent (a proof is stored, never run)', async () => {
      const script = Buffer.from(
        '%PDF-1.4\n<script>alert(1)</script>\n/JS (app.alert(1))\n',
      );
      const { booking, token } = await h.makeBooking();
      expect((await upload(token, script)).status).toBe(201);
      const [proof] = await proofsOf(booking.id);
      expect(await h.storage.read('private', proof.storage_key)).toEqual(
        script,
      );
      // and it can only be shown as the PDF it was found to be
      const shown = await h.asAdmin(
        h.http().get(`/api/admin/payment-proofs/${proof.id}/file`),
      );
      expect(shown.headers['content-type']).toBe('application/pdf');
      expect(shown.headers['x-content-type-options']).toBe('nosniff');
    });
  });

  describe('size', () => {
    it('refuses a file over 5 MB and stores none of it', async () => {
      const { booking, token } = await h.makeBooking();
      const res = await upload(
        token,
        Buffer.concat([PDF, Buffer.alloc(5 * MB)]),
      );
      expect(res.status).toBe(413);
      expect(errorBody(res).code).toBe('FILE_TOO_LARGE');
      expect(await proofsOf(booking.id)).toHaveLength(0);
      expect(await stored()).toHaveLength(0);
    });

    it('takes exactly 5 MB', async () => {
      const { token } = await h.makeBooking();
      const res = await upload(
        token,
        Buffer.concat([PDF, Buffer.alloc(5 * MB - PDF.length)]),
      );
      expect(res.status).toBe(201);
    });

    it('stops a huge upload early instead of reading it all into memory', async () => {
      const { booking, token } = await h.makeBooking();
      const body = Buffer.concat([PDF, Buffer.alloc(40 * MB)]);
      const before = process.memoryUsage().rss;
      const started = Date.now();
      const res = await upload(token, body);
      const grew = process.memoryUsage().rss - before;
      expect(res.status).toBe(413);
      // The 40 MB sits in this test's own memory; the app must not add its own
      // copies of all of it on top
      expect(grew).toBeLessThan(140 * MB);
      expect(Date.now() - started).toBeLessThan(15_000);
      expect(await proofsOf(booking.id)).toHaveLength(0);
      expect(await stored()).toHaveLength(0);
    });

    it('refuses an upload with other form fields or several files', async () => {
      const { booking, token } = await h.makeBooking();
      const extraField = await h
        .http()
        .post(`/api/booking/${token}/proofs`)
        .field('bookingId', '123')
        .attach('file', PDF, { filename: 'a.pdf' });
      const twoFiles = await h
        .http()
        .post(`/api/booking/${token}/proofs`)
        .attach('file', PDF, { filename: 'a.pdf' })
        .attach('file', PDF, { filename: 'b.pdf' });
      const wrongField = await h
        .http()
        .post(`/api/booking/${token}/proofs`)
        .attach('document', PDF, { filename: 'a.pdf' });
      for (const res of [extraField, twoFiles, wrongField])
        expect(res.status).toBe(400);
      expect(await proofsOf(booking.id)).toHaveLength(0);
      expect(await stored()).toHaveLength(0);
    });
  });

  describe('how many, and for which bookings', () => {
    it('stops at 3 proofs', async () => {
      const { booking, token } = await h.makeBooking();
      for (let i = 0; i < 3; i++)
        expect((await upload(token)).status).toBe(201);
      const fourth = await upload(token);
      expect(fourth.status).toBe(409);
      expect(errorBody(fourth).code).toBe('PROOF_LIMIT_REACHED');
      expect(await proofsOf(booking.id)).toHaveLength(3);
      expect(await stored()).toHaveLength(3);
    });

    it('refuses a Confirmed booking, before reading the file', async () => {
      const { booking, token } = await h.makeBooking({ status: 'confirmed' });
      const res = await upload(token);
      expect(res.status).toBe(409);
      expect(errorBody(res).code).toBe('BOOKING_NOT_PENDING');
      expect(await proofsOf(booking.id)).toHaveLength(0);
    });

    it.each(['cancelled', 'expired', 'completed', 'no_show'] as const)(
      'treats a %s booking as having no link at all',
      async (status) => {
        const { booking, token } = await h.makeBooking({ status });
        const res = await upload(token);
        expect(res.status).toBe(404);
        expect(errorBody(res).code).toBe('LINK_NOT_VALID');
        expect(await proofsOf(booking.id)).toHaveLength(0);
        expect(await stored()).toHaveLength(0);
      },
    );

    it('refuses once the appointment has started', async () => {
      const started = new Date(Date.now() - 60_000);
      const { token } = await h.makeBooking({
        start_at: started,
        end_at: new Date(started.getTime() + 60_000),
        occupied_until: new Date(started.getTime() + 120_000),
      });
      expect((await upload(token)).status).toBe(404);
    });

    it('limits attempts: 5 an hour for one booking', async () => {
      const { token } = await h.makeBooking();
      for (let i = 0; i < 5; i++)
        await upload(token, Buffer.from('not a proof'));
      expect((await upload(token)).status).toBe(429);
    });
  });

  describe('one client cannot reach another client’s booking', () => {
    it('puts a proof on its own booking only', async () => {
      const a = await h.makeBooking();
      const b = await h.makeBooking();
      expect((await upload(a.token)).status).toBe(201);
      expect(await proofsOf(a.booking.id)).toHaveLength(1);
      expect(await proofsOf(b.booking.id)).toHaveLength(0);
    });

    it('does not count one booking’s proofs towards another’s limit', async () => {
      const a = await h.makeBooking();
      const b = await h.makeBooking();
      for (let i = 0; i < 3; i++) await upload(a.token);
      expect((await upload(a.token)).status).toBe(409);
      expect((await upload(b.token)).status).toBe(201);
    });

    it('shows a client only their own proofs', async () => {
      const a = await h.makeBooking();
      const b = await h.makeBooking();
      await upload(b.token);
      await upload(b.token);
      const view = await h.http().get(`/api/booking/${a.token}`);
      expect(view.body.booking.proofs).toEqual([]);
      expect(view.body.proofsRemaining).toBe(3);
    });

    it('cannot be aimed at another booking with its id or reference in the request', async () => {
      const a = await h.makeBooking();
      const b = await h.makeBooking();
      const res = await h
        .http()
        .post(`/api/booking/${a.token}/proofs`)
        .field('bookingId', b.booking.id)
        .attach('file', PDF, { filename: 'p.pdf' });
      expect(res.status).toBe(400);
      expect(await proofsOf(b.booking.id)).toHaveLength(0);
      expect(
        (
          await h
            .http()
            .post(`/api/booking/${b.booking.id}/proofs`)
            .attach('file', PDF, { filename: 'p.pdf' })
        ).status,
      ).toBe(404);
      expect(
        (
          await h
            .http()
            .post(`/api/booking/${b.booking.reference}/proofs`)
            .attach('file', PDF, { filename: 'p.pdf' })
        ).status,
      ).toBe(404);
    });
  });

  describe('proof files are unreachable without an admin', () => {
    it('is refused to a visitor, a bad session and every guessable path', async () => {
      const { booking, token } = await h.makeBooking();
      await upload(token);
      const [proof] = await proofsOf(booking.id);
      const route = `/api/admin/payment-proofs/${proof.id}/file`;
      expect((await h.http().get(route)).status).toBe(401);
      expect(
        (await h.http().get(route).set('Cookie', 'mbg_session=guess')).status,
      ).toBe(401);
      expect((await h.http().get(`${route}?download=true`)).status).toBe(401);
      for (const path of [
        `/uploads/private/${proof.storage_key}`,
        `/uploads/${proof.storage_key}`,
        `/private/${proof.storage_key}`,
        `/${proof.storage_key}`,
        `/media/${proof.storage_key}.webp`,
        `/media/${proof.storage_key}`,
        `/api/media/${proof.storage_key}.webp`,
        `/api/booking/${token}/proofs/${proof.id}`,
        `/api/booking/${token}/file`,
        `/api/payment-proofs/${proof.id}/file`,
      ]) {
        const res = await h.http().get(path);
        expect(res.status, path).toBe(404);
        expect(JSON.stringify(res.body ?? '') + (res.text ?? '')).not.toContain(
          '%PDF',
        );
      }
    });

    it('is shown to an admin, and only as itself', async () => {
      const { booking, token } = await h.makeBooking();
      await upload(token);
      const [proof] = await proofsOf(booking.id);
      const res = await h
        .asAdmin(h.http().get(`/api/admin/payment-proofs/${proof.id}/file`))
        .buffer(true);
      expect(res.status).toBe(200);
      expect(Buffer.from(res.body as Buffer)).toEqual(PDF);
    });

    it('keeps the private area apart from the public one', async () => {
      const { token } = await h.makeBooking();
      await upload(token);
      expect(await stored()).toHaveLength(1);
      expect(await h.storage.list('public')).toHaveLength(0);
    });
  });

  describe('uploads that arrive together', () => {
    it('never get past 3, even when many are made at the same instant', async () => {
      const { booking } = await h.makeBooking();
      const link = await h.getBooking(booking.id);
      const service = h.app.get(PublicBookingService);
      const results = await Promise.allSettled(
        Array.from({ length: 12 }, () =>
          service.uploadProof(
            link,
            { buffer: PDF, originalname: 'p.pdf' },
            '127.0.0.1',
          ),
        ),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
      for (const refused of results.filter((r) => r.status === 'rejected')) {
        expect(refused.reason).toMatchObject({
          code: 'PROOF_LIMIT_REACHED',
        });
      }
      expect(await proofsOf(booking.id)).toHaveLength(3);
      // the files of the refused uploads were removed again
      expect(await stored()).toHaveLength(3);
    });

    it('keep to 3 over HTTP too, and each proof has its own file', async () => {
      const { booking, token } = await h.makeBooking();
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          upload(token, Buffer.concat([PDF, Buffer.from(String(i))])),
        ),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(3);
      expect(results.filter((r) => r.status === 409)).toHaveLength(2);
      const proofs = await proofsOf(booking.id);
      expect(proofs).toHaveLength(3);
      expect(new Set(proofs.map((p) => p.storage_key)).size).toBe(3);
      expect(await stored()).toHaveLength(3);
    });

    it('records the hash of each file, so a reused proof can be spotted', async () => {
      const a = await h.makeBooking();
      const b = await h.makeBooking();
      const same = Buffer.concat([PDF, Buffer.from('the same payment')]);
      await upload(a.token, same);
      await upload(b.token, same);
      const [pa] = await proofsOf(a.booking.id);
      const [pb] = await proofsOf(b.booking.id);
      expect(pa.sha256).toEqual(createHash('sha256').update(same).digest());
      expect(pa.sha256).toEqual(pb.sha256);
      expect(pa.storage_key).not.toBe(pb.storage_key);
    });
  });

  it('knows a storage key that is not one it made', () => {
    expect(newStorageKey()).toMatch(/^[a-f0-9]{64}$/);
  });
});
