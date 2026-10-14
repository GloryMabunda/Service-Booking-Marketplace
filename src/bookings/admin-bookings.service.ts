import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ExpressionBuilder, Kysely, Selectable } from 'kysely';
import {
  addDays,
  isoUtc,
  localDate,
  localDayRange,
  zonedTimeToUtc,
} from '../availability/time-zone.js';
import { ApiException } from '../common/api-error.js';
import { DATABASE } from '../database/database.module.js';
import type { DB } from '../database/database.types.js';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
} from '../payments/payment-provider.js';
import { SettingsService } from '../settings/settings.service.js';
import type { ListBookingsQuery } from './admin-booking.schema.js';
import { BOOKING_NOTIFIER, type BookingNotifier } from './booking-notifier.js';
import { assertTransition, type BookingStatus } from './booking-status.js';
import { generateBookingToken, hashBookingToken } from './booking-token.js';
import {
  type BookingRecord,
  BookingsRepository,
} from './bookings.repository.js';
import { derivePaymentStatus, type PaymentStatus } from './payment-status.js';
import { toCents } from '../common/money.js';

// A booking as the owner sees it (docs/api.md section 7, "AdminBooking"). The
// booking link token and its hash are never part of it (BR-15).
export interface AdminBooking {
  id: string;
  reference: string;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  service: { id: string; name: string };
  client: { name: string; email: string; phone: string };
  startAt: string;
  endAt: string;
  occupiedUntil: string;
  price: string;
  depositAmount: string;
  depositDueAt: string | null;
  amountReceived: string | null;
  paymentVerifiedAt: string | null;
  paymentVerifiedBy: string | null;
  refundDue: boolean;
  refundedAt: string | null;
  cancelledAt: string | null;
  cancelledBy: 'admin' | 'client' | null;
  notes: string | null;
  bookingLinkIssuedAt: string | null;
  proofCount: number;
  createdAt: string;
}

type BookingRow = Selectable<DB['bookings']> & {
  service_name: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SORTS = {
  startAt: ['start_at', 'asc'],
  '-startAt': ['start_at', 'desc'],
  createdAt: ['created_at', 'asc'],
  '-createdAt': ['created_at', 'desc'],
} as const;

const iso = (value: Date | string | null): string | null =>
  value ? isoUtc(new Date(value)) : null;

const notFound = () => new ApiException(404, 'NOT_FOUND', 'Booking not found.');

const changedMeanwhile = () =>
  new ApiException(
    409,
    'INVALID_STATUS_TRANSITION',
    'This booking has just changed. Reload it and try again.',
  );

// What the owner does with bookings (A-2, A-3, A-4, docs/api.md 7.1 to 7.8).
@Injectable()
export class AdminBookingsService {
  private readonly logger = new Logger(AdminBookingsService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly bookings: BookingsRepository,
    private readonly settings: SettingsService,
    @Inject(BOOKING_NOTIFIER) private readonly notifier: BookingNotifier,
    @Inject(PAYMENT_PROVIDER) private readonly payments: PaymentProvider,
  ) {}

  // --- Reading ------------------------------------------------------------

  async dashboard(now = new Date()) {
    const { timeZone } = await this.settings.get();
    const today = localDayRange(localDate(now, timeZone), timeZone);
    const monthStart = `${localDate(now, timeZone).slice(0, 8)}01`;
    const nextMonthStart = `${addDays(monthStart, 32).slice(0, 8)}01`;
    const thisMonth = {
      start: zonedTimeToUtc(monthStart, '00:00', timeZone),
      end: zonedTimeToUtc(nextMonthStart, '00:00', timeZone),
    };
    const active = ['pending', 'confirmed'] as const;

    const [todayN, upcomingN, completedN, awaitingN, proofsN, refundsN, next] =
      await Promise.all([
        this.db
          .selectFrom('bookings')
          .select((eb) => eb.fn.countAll<string>().as('n'))
          .where('status', 'in', active)
          .where('start_at', '>=', today.start)
          .where('start_at', '<', today.end)
          .executeTakeFirstOrThrow(),
        this.db
          .selectFrom('bookings')
          .select((eb) => eb.fn.countAll<string>().as('n'))
          .where('status', 'in', active)
          .where('start_at', '>', now)
          .executeTakeFirstOrThrow(),
        this.db
          .selectFrom('bookings')
          .select((eb) => eb.fn.countAll<string>().as('n'))
          .where('status', '=', 'completed')
          .where('start_at', '>=', thisMonth.start)
          .where('start_at', '<', thisMonth.end)
          .executeTakeFirstOrThrow(),
        this.db
          .selectFrom('bookings')
          .select((eb) => eb.fn.countAll<string>().as('n'))
          .where('status', '=', 'pending')
          .executeTakeFirstOrThrow(),
        this.db
          .selectFrom('payment_proofs')
          .select((eb) => eb.fn.countAll<string>().as('n'))
          .where('status', '=', 'received')
          .executeTakeFirstOrThrow(),
        this.db
          .selectFrom('bookings')
          .select((eb) => eb.fn.countAll<string>().as('n'))
          .where('refund_due', '=', true)
          .where('refunded_at', 'is', null)
          .executeTakeFirstOrThrow(),
        this.db
          .selectFrom('bookings')
          .innerJoin('services', 'services.id', 'bookings.service_id')
          .select([
            'bookings.id',
            'bookings.reference',
            'bookings.client_name',
            'bookings.start_at',
            'bookings.status',
            'services.name as service_name',
          ])
          .where('bookings.status', 'in', active)
          .where('bookings.start_at', '>', now)
          .orderBy('bookings.start_at')
          .limit(10)
          .execute(),
      ]);

    return {
      today: Number(todayN.n),
      upcoming: Number(upcomingN.n),
      completedThisMonth: Number(completedN.n),
      awaitingDeposit: Number(awaitingN.n),
      proofsAwaitingReview: Number(proofsN.n),
      refundsDue: Number(refundsN.n),
      upcomingAppointments: next.map((row) => ({
        id: row.id,
        reference: row.reference,
        clientName: row.client_name,
        serviceName: row.service_name,
        startAt: iso(row.start_at),
        status: row.status,
      })),
    };
  }

  async list(query: ListBookingsQuery) {
    const { timeZone } = await this.settings.get();
    const filter = (eb: ExpressionBuilder<DB, 'bookings' | 'services'>) => {
      const conditions = [];
      if (query.status) {
        conditions.push(eb('bookings.status', 'in', query.status));
      }
      if (query.from) {
        conditions.push(
          eb(
            'bookings.start_at',
            '>=',
            localDayRange(query.from, timeZone).start,
          ),
        );
      }
      if (query.to) {
        conditions.push(
          eb('bookings.start_at', '<', localDayRange(query.to, timeZone).end),
        );
      }
      if (query.proof) {
        conditions.push(
          eb.exists(
            eb
              .selectFrom('payment_proofs')
              .select('payment_proofs.id')
              .whereRef('payment_proofs.booking_id', '=', 'bookings.id')
              .where('payment_proofs.status', '=', 'received'),
          ),
        );
      }
      if (query.refund) {
        // A refund the owner still has to pay (BR-12)
        conditions.push(
          eb.and([
            eb('bookings.refund_due', '=', true),
            eb('bookings.refunded_at', 'is', null),
          ]),
        );
      }
      if (query.q) {
        // Characters with a special meaning in LIKE are searched for literally
        const pattern = `%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        conditions.push(
          eb.or([
            eb('bookings.reference', 'ilike', pattern),
            eb('bookings.client_name', 'ilike', pattern),
            eb('bookings.client_email', 'ilike', pattern),
            eb('bookings.client_phone', 'ilike', pattern),
          ]),
        );
      }
      return eb.and(conditions);
    };

    const [column, direction] = SORTS[query.sort];
    const [rows, total] = await Promise.all([
      this.baseQuery()
        .where(filter)
        .orderBy(`bookings.${column}`, direction)
        // A second key keeps the pages stable when times are equal
        .orderBy('bookings.id')
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize)
        .execute(),
      this.db
        .selectFrom('bookings')
        .innerJoin('services', 'services.id', 'bookings.service_id')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where(filter)
        .executeTakeFirstOrThrow(),
    ]);
    return {
      items: await this.toAdminBookings(rows),
      page: query.page,
      pageSize: query.pageSize,
      total: Number(total.n),
    };
  }

  async get(id: string) {
    const booking = await this.one(id);
    const proofs = await this.db
      .selectFrom('payment_proofs')
      .selectAll()
      .where('booking_id', '=', id)
      .orderBy('uploaded_at')
      .execute();

    // Other bookings with a proof of the same file, to spot a reused proof
    const hashes = proofs.map((p) => p.sha256);
    const reused = hashes.length
      ? await this.db
          .selectFrom('payment_proofs')
          .innerJoin('bookings', 'bookings.id', 'payment_proofs.booking_id')
          .select(['payment_proofs.sha256', 'bookings.reference'])
          .where('payment_proofs.sha256', 'in', hashes)
          .where('payment_proofs.booking_id', '!=', id)
          .execute()
      : [];

    const notifications = await this.db
      .selectFrom('notifications')
      .select(['type', 'recipient', 'status', 'sent_at', 'error'])
      .where('booking_id', '=', id)
      .orderBy('created_at')
      .execute();

    return {
      booking,
      proofs: proofs.map((p) => ({
        id: p.id,
        originalFilename: p.original_filename,
        contentType: p.content_type,
        sizeBytes: p.size_bytes,
        sha256: p.sha256.toString('hex'),
        usedOnOtherBookings: reused
          .filter((r) => r.sha256.equals(p.sha256))
          .map((r) => r.reference),
        status: p.status,
        rejectionReason: p.rejection_reason,
        uploadedAt: iso(p.uploaded_at),
        uploadedFromIp: p.uploaded_from_ip,
        reviewedAt: iso(p.reviewed_at),
        reviewedBy: p.reviewed_by,
        fileDeletedAt: iso(p.file_deleted_at),
      })),
      notifications: notifications.map((n) => ({
        type: n.type,
        recipient: n.recipient,
        status: n.status,
        sentAt: iso(n.sent_at),
        error: n.error,
      })),
    };
  }

  // --- Actions ------------------------------------------------------------

  // The owner has seen the money in her bank account (BR-8). Records the
  // amount, the time and who confirmed, issues a fresh booking link and emails
  // it with the confirmation (BR-15).
  async confirmPayment(
    id: string,
    amountReceived: string,
    adminId: string,
    now = new Date(),
  ) {
    const booking = await this.mustFind(id);
    assertTransition(booking.status, 'confirmed');
    const payment = await this.payments.confirmPayment({
      bookingId: id,
      amountReceived,
      confirmedBy: adminId,
      now,
    });

    const token = generateBookingToken();
    const row = await this.db
      .updateTable('bookings')
      .set({
        status: 'confirmed',
        amount_received: payment.amountReceived,
        payment_verified_at: payment.verifiedAt,
        payment_verified_by: payment.verifiedBy,
        booking_token_hash: hashBookingToken(token),
        booking_token_created_at: now,
        updated_at: now,
      })
      .where('id', '=', id)
      .where('status', '=', 'pending')
      .returning('id')
      .executeTakeFirst();
    // Someone, or the expiry job, changed it a moment ago
    if (!row) throw changedMeanwhile();

    const saved = await this.mustFind(id);
    const emailSent = await this.attempt(
      () => this.notifier.bookingConfirmed(saved, token),
      `The confirmation email for ${saved.reference}`,
    );
    return {
      booking: await this.one(id),
      emailSentTo: emailSent ? saved.clientEmail : null,
    };
  }

  // Gives a Pending booking more time to pay (BR-9)
  async extendDeadline(id: string, depositDueAt: Date, now = new Date()) {
    const booking = await this.mustFind(id);
    if (booking.status !== 'pending') {
      throw new ApiException(
        409,
        'INVALID_STATUS_TRANSITION',
        'Only a Pending booking has a deposit deadline to extend.',
      );
    }
    if (depositDueAt <= now || depositDueAt >= booking.startAt) {
      throw new ApiException(
        400,
        'VALIDATION_FAILED',
        'Some details are missing or invalid.',
        [
          {
            field: 'depositDueAt',
            message:
              'The deadline must be in the future and before the appointment starts.',
          },
        ],
      );
    }
    const row = await this.db
      .updateTable('bookings')
      .set({ deposit_due_at: depositDueAt, updated_at: now })
      .where('id', '=', id)
      .where('status', '=', 'pending')
      .returning('id')
      .executeTakeFirst();
    if (!row) throw changedMeanwhile();
    return { booking: await this.one(id) };
  }

  // Cancels, completes or marks a no-show (BR-3, BR-12)
  async changeStatus(
    id: string,
    change: {
      status: 'cancelled' | 'completed' | 'no_show';
      refundDue?: boolean;
    },
    now = new Date(),
  ) {
    const booking = await this.mustFind(id);
    assertTransition(booking.status, change.status);
    let emailSentTo: string | null = null;

    if (change.status === 'cancelled') {
      this.checkRefundChoice(booking, change.refundDue);
      const row = await this.db
        .updateTable('bookings')
        .set({
          status: 'cancelled',
          cancelled_at: now,
          cancelled_by: 'admin',
          refund_due: change.refundDue === true,
          updated_at: now,
        })
        .where('id', '=', id)
        .where('status', '=', booking.status)
        .returning('id')
        .executeTakeFirst();
      if (!row) throw changedMeanwhile();
      const saved = await this.mustFind(id);
      const emailSent = await this.attempt(
        () => this.notifier.bookingCancelled(saved),
        `The cancellation email for ${saved.reference}`,
      );
      emailSentTo = emailSent ? saved.clientEmail : null;
    } else {
      if (change.refundDue !== undefined) {
        throw invalid('refundDue', 'refundDue only applies to a cancellation.');
      }
      if (now < booking.startAt) {
        throw new ApiException(
          409,
          'INVALID_STATUS_TRANSITION',
          'A booking can only be marked completed or no-show once the appointment has started.',
        );
      }
      const row = await this.db
        .updateTable('bookings')
        .set({ status: change.status, updated_at: now })
        .where('id', '=', id)
        .where('status', '=', 'confirmed')
        .returning('id')
        .executeTakeFirst();
      if (!row) throw changedMeanwhile();
    }
    // emailSentTo is only meaningful for a cancellation, the one change that
    // emails the client
    return {
      booking: await this.one(id),
      ...(change.status === 'cancelled' ? { emailSentTo } : {}),
    };
  }

  // The owner has paid a refund that was due (BR-12). Only a booking with a
  // refund due and not yet recorded can be marked, and only once.
  async recordRefund(id: string, now = new Date()) {
    await this.mustFind(id);
    const row = await this.db
      .updateTable('bookings')
      .set({ refunded_at: now, updated_at: now })
      .where('id', '=', id)
      .where('refund_due', '=', true)
      .where('refunded_at', 'is', null)
      .returning('id')
      .executeTakeFirst();
    if (!row) {
      throw new ApiException(
        409,
        'NO_REFUND_DUE',
        'No refund is due for this booking, or it has already been recorded.',
      );
    }
    return { booking: await this.one(id) };
  }

  // A new booking link, emailed to the client; the old one stops working
  // (BR-15)
  async reissueLink(id: string, now = new Date()) {
    const booking = await this.mustFind(id);
    const token = generateBookingToken();
    const saved = await this.bookings.reissueLink(
      booking.id,
      hashBookingToken(token),
      now,
    );
    if (!saved) {
      throw new ApiException(
        409,
        'INVALID_STATUS_TRANSITION',
        'Only a Pending or Confirmed booking, before the appointment starts, can have a new link.',
      );
    }
    const emailSent = await this.attempt(
      () => this.notifier.bookingLinkReissued(saved, token),
      `The new link for ${saved.reference}`,
    );
    return {
      bookingLinkIssuedAt: isoUtc(now),
      emailSentTo: emailSent ? saved.clientEmail : null,
    };
  }

  // --- Helpers ------------------------------------------------------------

  // The owner decides whether she owes a refund when she cancels a Confirmed
  // booking (BR-12); a Pending booking has no confirmed deposit to refund.
  private checkRefundChoice(booking: BookingRecord, refundDue?: boolean) {
    if (booking.status === 'confirmed') {
      if (refundDue === undefined) {
        throw invalid(
          'refundDue',
          'Say whether a refund is due: true or false.',
        );
      }
      if (refundDue && toCents(booking.depositAmount) === 0) {
        throw invalid('refundDue', 'There is no deposit to refund.');
      }
    } else if (refundDue !== undefined) {
      throw invalid(
        'refundDue',
        'A Pending booking has no confirmed deposit, so nothing is marked as due.',
      );
    }
  }

  private async mustFind(id: string): Promise<BookingRecord> {
    const booking = UUID.test(id) ? await this.bookings.findById(id) : null;
    if (!booking) throw notFound();
    return booking;
  }

  private async one(id: string): Promise<AdminBooking> {
    const row = UUID.test(id)
      ? await this.baseQuery().where('bookings.id', '=', id).executeTakeFirst()
      : undefined;
    if (!row) throw notFound();
    const [booking] = await this.toAdminBookings([row]);
    return booking;
  }

  private baseQuery() {
    return this.db
      .selectFrom('bookings')
      .innerJoin('services', 'services.id', 'bookings.service_id')
      .selectAll('bookings')
      .select('services.name as service_name');
  }

  private async toAdminBookings(rows: BookingRow[]): Promise<AdminBooking[]> {
    const proofs = rows.length
      ? await this.db
          .selectFrom('payment_proofs')
          .select(['booking_id', 'status'])
          .where(
            'booking_id',
            'in',
            rows.map((r) => r.id),
          )
          .execute()
      : [];
    return rows.map((row) => {
      const own = proofs.filter((p) => p.booking_id === row.id);
      return {
        id: row.id,
        reference: row.reference,
        status: row.status,
        paymentStatus: derivePaymentStatus({
          status: row.status,
          depositAmount: row.deposit_amount,
          paymentVerifiedAt: row.payment_verified_at
            ? new Date(row.payment_verified_at)
            : null,
          proofs: own.map((p) => ({ status: p.status })),
        }),
        service: { id: row.service_id, name: row.service_name },
        client: {
          name: row.client_name,
          email: row.client_email,
          phone: row.client_phone,
        },
        startAt: iso(row.start_at) as string,
        endAt: iso(row.end_at) as string,
        occupiedUntil: iso(row.occupied_until) as string,
        price: row.price_at_booking,
        depositAmount: row.deposit_amount,
        depositDueAt: iso(row.deposit_due_at),
        amountReceived: row.amount_received,
        paymentVerifiedAt: iso(row.payment_verified_at),
        paymentVerifiedBy: row.payment_verified_by,
        refundDue: row.refund_due,
        refundedAt: iso(row.refunded_at),
        cancelledAt: iso(row.cancelled_at),
        cancelledBy: row.cancelled_by,
        notes: row.notes,
        bookingLinkIssuedAt: iso(row.booking_token_created_at),
        proofCount: own.length,
        createdAt: iso(row.created_at) as string,
      };
    });
  }

  // Runs a notification; a failure is logged and never undoes the change
  // (spec section 7). Returns whether it reported success.
  private async attempt<T>(
    send: () => Promise<T>,
    what: string,
  ): Promise<boolean> {
    try {
      return (await send()) !== false;
    } catch (error) {
      this.logger.error(
        `${what} could not be sent: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }
}

function invalid(field: string, message: string): ApiException {
  return new ApiException(
    400,
    'VALIDATION_FAILED',
    'Some details are missing or invalid.',
    [{ field, message }],
  );
}
