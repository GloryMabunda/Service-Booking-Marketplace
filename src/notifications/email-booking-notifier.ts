import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Kysely } from 'kysely';
import type { BookingNotifier } from '../bookings/booking-notifier.js';
import { bookingLink } from '../bookings/booking-token.js';
import type { BookingRecord } from '../bookings/bookings.repository.js';
import { formatCents, toCents } from '../common/money.js';
import type { Env } from '../config/env.js';
import { DATABASE } from '../database/database.module.js';
import type { DB } from '../database/database.types.js';
import type { Settings } from '../settings/settings.schema.js';
import { SettingsService } from '../settings/settings.service.js';
import {
  renderAdminNewBooking,
  renderBookingExpired,
  renderConfirmedNoDeposit,
} from './booking-emails.js';
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
        portalUrl: `${this.siteUrl()}/admin/bookings/${booking.id}`,
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
