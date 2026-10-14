import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Kysely } from 'kysely';
import type { BookingNotifier } from '../bookings/booking-notifier.js';
import type { BookingStatus } from '../bookings/booking-status.js';
import { bookingLink } from '../bookings/booking-token.js';
import type { BookingRecord } from '../bookings/bookings.repository.js';
import { isRefundable, refundDeadline } from '../bookings/refund-rule.js';
import { formatCents, toCents } from '../common/money.js';
import type { Env } from '../config/env.js';
import { DATABASE } from '../database/database.module.js';
import type { DB } from '../database/database.types.js';
import type { Settings } from '../settings/settings.schema.js';
import { SettingsService } from '../settings/settings.service.js';
import {
  type ClientCancelRefund,
  renderAdminClientCancelled,
  renderAdminProofUploaded,
} from './admin-emails.js';
import { renderProofRejected } from './proof-emails.js';
import {
  renderAdminNewBooking,
  renderBookingExpired,
  renderConfirmedNoDeposit,
} from './booking-emails.js';
import {
  type CancelledRefund,
  type ConfirmedRefund,
  renderBookingCancelled,
  renderPaymentConfirmed,
} from './booking-status-emails.js';
import { formatRand, formatTime, formatWhen } from './email-format.js';
import { NotificationsService } from './notifications.service.js';
import {
  type RenderedEmail,
  renderPaymentInstructions,
} from './payment-instructions.template.js';

// Sends the emails about a booking (C-5, C-6, BR-9, BR-15). The booking link is
// built here from the token handed over in memory, goes into one email and is
// neither stored nor logged.
@Injectable()
export class EmailBookingNotifier implements BookingNotifier {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async bookingCreated(
    booking: BookingRecord,
    token: string,
  ): Promise<boolean> {
    // The owner's email is separate: if it fails, the client still gets theirs
    const [clientSent] = await Promise.all([
      this.clientLinkEmail(booking, token, false),
      this.tellOwner(booking).catch(() => undefined),
    ]);
    return clientSent;
  }

  bookingLinkReissued(booking: BookingRecord, token: string): Promise<boolean> {
    return this.clientLinkEmail(booking, token, true);
  }

  async bookingExpired(booking: BookingRecord): Promise<void> {
    const { settings, service } = await this.context(booking);
    const { timeZone } = settings;
    await this.notifications.sendEmail({
      bookingId: booking.id,
      type: 'booking_expired',
      to: booking.clientEmail,
      replyTo: settings.businessEmail,
      email: renderBookingExpired({
        clientFirstName: firstName(booking),
        business: business(settings),
        reference: booking.reference,
        service,
        when: formatWhen(booking.startAt, timeZone),
        deadline: formatWhen(booking.depositDueAt ?? booking.startAt, timeZone),
        bookUrl: `${this.siteUrl()}/services.html`,
      }),
    });
  }

  // 4.2a: the owner confirmed the deposit. The new booking link goes in this
  // email, with the deadline for a refund (BR-12, BR-15).
  async bookingConfirmed(
    booking: BookingRecord,
    token: string,
  ): Promise<boolean> {
    const { settings, service } = await this.context(booking);
    const { timeZone } = settings;
    const received = booking.amountReceived ?? booking.depositAmount;
    let refund: ConfirmedRefund;
    if (!settings.depositRefundable) {
      refund = { kind: 'never' };
    } else if (isRefundable(settings, booking.startAt, new Date())) {
      refund = {
        kind: 'until',
        cutoff: formatWhen(
          refundDeadline(booking.startAt, settings.refundCutoffHours),
          timeZone,
        ),
        cutoffHours: settings.refundCutoffHours,
      };
    } else {
      refund = { kind: 'passed' };
    }
    return this.notifications.sendEmail({
      bookingId: booking.id,
      type: 'booking_confirmed',
      to: booking.clientEmail,
      replyTo: settings.businessEmail,
      email: renderPaymentConfirmed({
        clientFirstName: firstName(booking),
        business: business(settings),
        reference: booking.reference,
        service,
        when: formatWhen(booking.startAt, timeZone),
        endTime: formatTime(booking.endAt, timeZone),
        price: formatRand(booking.priceAtBooking),
        amountReceived: formatRand(received),
        balance: formatRand(
          formatCents(toCents(booking.priceAtBooking) - toCents(received)),
        ),
        refund,
        link: bookingLink(this.siteUrl(), token),
      }),
    });
  }

  // 4.4: the booking was cancelled. What the client is told about the deposit
  // follows what was recorded when it was cancelled (BR-12).
  async bookingCancelled(booking: BookingRecord): Promise<boolean> {
    const { settings, service } = await this.context(booking);
    const { timeZone } = settings;
    const cancelledBy = booking.cancelledBy ?? 'admin';
    let refund: CancelledRefund = { kind: 'none' };
    if (toCents(booking.depositAmount) === 0) {
      refund = { kind: 'none' };
    } else if (booking.refundDue) {
      refund = {
        kind: 'due',
        amount: formatRand(booking.amountReceived ?? booking.depositAmount),
      };
    } else if (booking.amountReceived === null) {
      refund = { kind: 'pending' };
    } else if (cancelledBy === 'client') {
      refund = {
        kind: 'not_refundable',
        cutoffHours: settings.refundCutoffHours,
      };
    }
    return this.notifications.sendEmail({
      bookingId: booking.id,
      type: 'booking_cancelled',
      to: booking.clientEmail,
      replyTo: settings.businessEmail,
      email: renderBookingCancelled({
        clientFirstName: firstName(booking),
        business: business(settings),
        reference: booking.reference,
        service,
        when: formatWhen(booking.startAt, timeZone),
        endTime: formatTime(booking.endAt, timeZone),
        price: formatRand(booking.priceAtBooking),
        cancelledBy,
        refund,
        bookUrl: `${this.siteUrl()}/services.html`,
      }),
    });
  }

  // 4.3: the owner rejected a proof. The reason is hers, shown as written; the
  // email points to the Find my booking page and carries no link (BR-14).
  async proofRejected(
    booking: BookingRecord,
    reason: string,
  ): Promise<boolean> {
    const { settings, service } = await this.context(booking);
    const { timeZone } = settings;
    return this.notifications.sendEmail({
      bookingId: booking.id,
      type: 'proof_rejected',
      to: booking.clientEmail,
      replyTo: settings.businessEmail,
      email: renderProofRejected({
        clientFirstName: firstName(booking),
        business: business(settings),
        reference: booking.reference,
        service,
        when: formatWhen(booking.startAt, timeZone),
        reason,
        deposit: formatRand(booking.depositAmount),
        deadline: formatWhen(booking.depositDueAt ?? booking.startAt, timeZone),
        lookupUrl: `${this.siteUrl()}/lookup.html`,
      }),
    });
  }

  // 5.2: a client uploaded a proof. The owner is told to check the bank before
  // confirming; the email links to the booking in the portal.
  async proofUploaded(
    booking: BookingRecord,
    proof: { uploadedAt: Date; count: number },
  ): Promise<void> {
    const { settings, service } = await this.context(booking);
    const { timeZone } = settings;
    await this.notifications.sendEmail({
      bookingId: booking.id,
      type: 'admin_proof_uploaded',
      to: settings.businessEmail,
      email: renderAdminProofUploaded({
        clientName: booking.clientName,
        reference: booking.reference,
        service,
        when: formatWhen(booking.startAt, timeZone),
        deposit: formatRand(booking.depositAmount),
        deadline: formatWhen(booking.depositDueAt ?? booking.startAt, timeZone),
        uploadedAt: formatWhen(proof.uploadedAt, timeZone),
        count: `${proof.count} of 3`,
        portalUrl: this.portalUrl(booking),
      }),
    });
  }

  // 5.3: a client cancelled. The refund block follows what was recorded when
  // they cancelled (BR-12).
  async clientCancelled(
    booking: BookingRecord,
    previousStatus: BookingStatus,
  ): Promise<void> {
    const { settings, service } = await this.context(booking);
    const { timeZone } = settings;
    let refund: ClientCancelRefund = { kind: 'none' };
    if (toCents(booking.depositAmount) > 0) {
      if (booking.refundDue) {
        refund = {
          kind: 'due',
          amount: formatRand(booking.amountReceived ?? booking.depositAmount),
        };
      } else {
        refund =
          previousStatus === 'pending'
            ? { kind: 'pending' }
            : { kind: 'outside_rule' };
      }
    }
    await this.notifications.sendEmail({
      bookingId: booking.id,
      type: 'admin_client_cancelled',
      to: settings.businessEmail,
      email: renderAdminClientCancelled({
        clientName: booking.clientName,
        clientEmail: booking.clientEmail,
        clientPhone: booking.clientPhone,
        reference: booking.reference,
        service,
        when: formatWhen(booking.startAt, timeZone),
        previousStatus: previousStatus === 'pending' ? 'Pending' : 'Confirmed',
        refund,
        portalUrl: this.portalUrl(booking),
      }),
    });
  }

  private portalUrl(booking: BookingRecord): string {
    return `${this.siteUrl()}/admin/booking.html?id=${booking.id}`;
  }

  // The email that carries the booking link: payment instructions while the
  // booking is Pending, the confirmation once no deposit is owed
  private async clientLinkEmail(
    booking: BookingRecord,
    token: string,
    newLink: boolean,
  ): Promise<boolean> {
    const { settings, service } = await this.context(booking);
    const { timeZone } = settings;
    const link = bookingLink(this.siteUrl(), token);
    let email: RenderedEmail;
    let type: 'payment_instructions' | 'booking_confirmed';

    if (booking.status === 'pending' && booking.depositDueAt) {
      type = 'payment_instructions';
      const balance = formatCents(
        toCents(booking.priceAtBooking) - toCents(booking.depositAmount),
      );
      email = renderPaymentInstructions({
        clientFirstName: firstName(booking),
        business: business(settings),
        reference: booking.reference,
        service,
        when: formatWhen(booking.startAt, timeZone),
        endTime: formatTime(booking.endAt, timeZone),
        price: formatRand(booking.priceAtBooking),
        deposit: formatRand(booking.depositAmount),
        balance: formatRand(balance),
        deadline: formatWhen(booking.depositDueAt, timeZone),
        bank: settings.bankingDetails,
        link,
        newLink,
      });
    } else {
      type = 'booking_confirmed';
      email = renderConfirmedNoDeposit({
        clientFirstName: firstName(booking),
        business: business(settings),
        reference: booking.reference,
        service,
        when: formatWhen(booking.startAt, timeZone),
        endTime: formatTime(booking.endAt, timeZone),
        price: formatRand(booking.priceAtBooking),
        link,
        newLink,
      });
    }
    return this.notifications.sendEmail({
      bookingId: booking.id,
      type,
      to: booking.clientEmail,
      replyTo: settings.businessEmail,
      email,
    });
  }

  // Tells the owner a booking was made (5.1). The owner's email never holds
  // the booking link; the button opens the booking in the portal.
  private async tellOwner(booking: BookingRecord): Promise<void> {
    const { settings, service } = await this.context(booking);
    const { timeZone } = settings;
    const deadline = booking.status === 'pending' ? booking.depositDueAt : null;
    await this.notifications.sendEmail({
      bookingId: booking.id,
      type: 'admin_new_booking',
      to: settings.businessEmail,
      email: renderAdminNewBooking({
        reference: booking.reference,
        service,
        when: formatWhen(booking.startAt, timeZone),
        endTime: formatTime(booking.endAt, timeZone),
        price: formatRand(booking.priceAtBooking),
        clientName: booking.clientName,
        clientEmail: booking.clientEmail,
        clientPhone: booking.clientPhone,
        deposit: deadline
          ? {
              amount: formatRand(booking.depositAmount),
              deadline: formatWhen(deadline, timeZone),
            }
          : null,
        notes: booking.notes,
        portalUrl: this.portalUrl(booking),
      }),
    });
  }

  private async context(
    booking: BookingRecord,
  ): Promise<{ settings: Settings; service: string }> {
    const settings = await this.settings.get();
    const row = await this.db
      .selectFrom('services')
      .select('name')
      .where('id', '=', booking.serviceId)
      .executeTakeFirstOrThrow();
    return { settings, service: row.name };
  }

  private siteUrl(): string {
    const configured = this.config.get('PUBLIC_URL', { infer: true });
    const port = this.config.get('PORT', { infer: true });
    return (configured ?? `http://localhost:${port}`).replace(/\/+$/, '');
  }
}

const firstName = (booking: BookingRecord) =>
  booking.clientName.trim().split(/\s+/)[0] ?? '';

const business = (settings: Settings) => ({
  name: settings.businessName,
  email: settings.businessEmail,
  phone: settings.businessPhone,
});
