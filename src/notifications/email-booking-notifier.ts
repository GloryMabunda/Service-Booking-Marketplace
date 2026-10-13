import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Kysely } from 'kysely';
import type { BookingNotifier } from '../bookings/booking-notifier.js';
import type { BookingRecord } from '../bookings/bookings.repository.js';
import { formatCents, toCents } from '../common/money.js';
import type { Env } from '../config/env.js';
import { DATABASE } from '../database/database.module.js';
import type { DB } from '../database/database.types.js';
import { SettingsService } from '../settings/settings.service.js';
import { formatRand, formatTime, formatWhen } from './email-format.js';
import { NotificationsService } from './notifications.service.js';
import { renderPaymentInstructions } from './payment-instructions.template.js';

// Tells a client about their new booking by email (C-5, #56). The booking
// link is built here from the token handed over in memory, goes into this one
// email and is neither stored nor logged (BR-15).
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
    // A booking with no deposit is confirmed at once; its email is #57
    if (booking.status !== 'pending' || !booking.depositDueAt) return false;

    const settings = await this.settings.get();
    const service = await this.db
      .selectFrom('services')
      .select('name')
      .where('id', '=', booking.serviceId)
      .executeTakeFirstOrThrow();
    const { timeZone } = settings;
    const balance = formatCents(
      toCents(booking.priceAtBooking) - toCents(booking.depositAmount),
    );

    const email = renderPaymentInstructions({
      clientFirstName: booking.clientName.trim().split(/\s+/)[0] ?? '',
      business: {
        name: settings.businessName,
        email: settings.businessEmail,
        phone: settings.businessPhone,
      },
      reference: booking.reference,
      service: service.name,
      when: formatWhen(booking.startAt, timeZone),
      endTime: formatTime(booking.endAt, timeZone),
      price: formatRand(booking.priceAtBooking),
      deposit: formatRand(booking.depositAmount),
      balance: formatRand(balance),
      deadline: formatWhen(booking.depositDueAt, timeZone),
      bank: settings.bankingDetails,
      link: `${this.siteUrl()}/booking/${token}`,
    });

    return this.notifications.sendEmail({
      bookingId: booking.id,
      type: 'payment_instructions',
      to: booking.clientEmail,
      email,
      replyTo: settings.businessEmail,
    });
  }

  private siteUrl(): string {
    const configured = this.config.get('PUBLIC_URL', { infer: true });
    const port = this.config.get('PORT', { infer: true });
    return (configured ?? `http://localhost:${port}`).replace(/\/+$/, '');
  }
}
