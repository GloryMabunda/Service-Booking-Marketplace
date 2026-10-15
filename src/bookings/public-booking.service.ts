import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { isoUtc } from '../availability/time-zone.js';
import { ApiException } from '../common/api-error.js';
import { toCents } from '../common/money.js';
import { DATABASE } from '../database/database.module.js';
import type { DB } from '../database/database.types.js';
import { formatRand } from '../notifications/email-format.js';
import {
  FILE_STORAGE,
  type FileStorage,
  newStorageKey,
} from '../storage/file-storage.js';
import type { Settings } from '../settings/settings.schema.js';
import { SettingsService } from '../settings/settings.service.js';
import { BOOKING_NOTIFIER, type BookingNotifier } from './booking-notifier.js';
import { type LinkedBooking, linkNotValid } from './booking-link.guard.js';
import { toBookingSummary } from './booking-lookup.service.js';
import { BookingsRepository } from './bookings.repository.js';
import {
  cleanFilename,
  detectProofType,
  MAX_PROOFS_PER_BOOKING,
  sha256,
} from './proof-file.js';
import { isRefundable } from './refund-rule.js';

// What the client sees before cancelling (docs/api.md 5.1, C-8): whether the
// deposit would be refunded and why, in plain language.
export interface CancellationInfo {
  refundEligible: boolean;
  refundAmount: string | null;
  explanation: string;
}

export function describeCancellation(
  booking: Pick<
    LinkedBooking,
    'status' | 'start_at' | 'deposit_amount' | 'amount_received'
  >,
  settings: Pick<Settings, 'depositRefundable' | 'refundCutoffHours'>,
  now: Date,
): CancellationInfo {
  if (booking.status === 'pending') {
    return {
      refundEligible: false,
      refundAmount: null,
      explanation:
        "Your deposit hasn't been confirmed yet, so no refund will be recorded. If you have already paid, please contact us.",
    };
  }
  if (toCents(booking.deposit_amount) === 0) {
    return {
      refundEligible: false,
      refundAmount: null,
      explanation:
        'No deposit was taken for this booking, so there is nothing to refund.',
    };
  }
  const amount = booking.amount_received ?? booking.deposit_amount;
  if (!settings.depositRefundable) {
    return {
      refundEligible: false,
      refundAmount: null,
      explanation:
        "Deposits aren't refundable, so your deposit won't be returned.",
    };
  }
  if (isRefundable(settings, new Date(booking.start_at), now)) {
    return {
      refundEligible: true,
      refundAmount: amount,
      explanation: `You'll get your deposit of ${formatRand(amount)} back, because you're cancelling at least ${settings.refundCutoffHours} hours before your appointment. We'll be in touch to arrange it.`,
    };
  }
  return {
    refundEligible: false,
    refundAmount: null,
    explanation: `Your appointment is less than ${settings.refundCutoffHours} hours away, so your deposit isn't refundable.`,
  };
}

// What a client can do through their booking link (C-7, C-8, BR-14, BR-15).
@Injectable()
export class PublicBookingService {
  private readonly logger = new Logger(PublicBookingService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly bookings: BookingsRepository,
    private readonly settings: SettingsService,
    @Inject(BOOKING_NOTIFIER) private readonly notifier: BookingNotifier,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  // The booking page's data (docs/api.md 5.1). Reading it changes nothing.
  async view(link: LinkedBooking, now = new Date()) {
    const settings = await this.settings.get();
    const [service, proofs] = await Promise.all([
      this.db
        .selectFrom('services')
        .select('name')
        .where('id', '=', link.service_id)
        .executeTakeFirstOrThrow(),
      this.db
        .selectFrom('payment_proofs')
        .select(['uploaded_at', 'status', 'rejection_reason'])
        .where('booking_id', '=', link.id)
        .orderBy('uploaded_at')
        .execute(),
    ]);
    const pending = link.status === 'pending';
    return {
      booking: toBookingSummary(
        { ...link, service_name: service.name },
        proofs,
        settings.timeZone,
      ),
      // The owner's address, for a client who comes to her (#115). It is only
      // on this private page and in emails, never on the public site.
      ownerAddress: link.location === 'studio' ? settings.homeAddress : null,
      // The banking details are only needed while there is a deposit to pay
      bankingDetails: pending ? settings.bankingDetails : null,
      business: {
        name: settings.businessName,
        email: settings.businessEmail,
        phone: settings.businessPhone,
      },
      canUploadProof: pending && proofs.length < MAX_PROOFS_PER_BOOKING,
      proofsRemaining: Math.max(0, MAX_PROOFS_PER_BOOKING - proofs.length),
      canCancel: true,
      cancellation: describeCancellation(link, settings, now),
    };
  }

  // Checked before the file is read from the request, so a booking that can't
  // take a proof is refused without streaming anything (BR-14)
  async assertCanUpload(link: LinkedBooking): Promise<void> {
    if (link.status !== 'pending') {
      throw new ApiException(
        409,
        'BOOKING_NOT_PENDING',
        'A proof of payment can only be uploaded while the booking is waiting for its deposit.',
      );
    }
    const count = await this.proofCount(link.id);
    if (count >= MAX_PROOFS_PER_BOOKING) throw limitReached();
  }

  // Stores a proof of payment (BR-14, docs/api.md 5.2)
  async uploadProof(
    link: LinkedBooking,
    file: { buffer: Buffer; originalname?: string },
    ip: string,
  ) {
    if (file.buffer.length === 0) {
      throw new ApiException(400, 'FILE_INVALID', 'That file is empty.');
    }
    const contentType = detectProofType(file.buffer);
    if (!contentType) {
      throw new ApiException(
        415,
        'UNSUPPORTED_FILE_TYPE',
        'Please upload a PDF, JPEG or PNG file.',
      );
    }

    // Saved first under a random key; if recording it fails the file is
    // removed again, so no file is left without a record
    const key = newStorageKey();
    await this.storage.save('private', key, file.buffer);
    let uploaded: { uploadedAt: Date; count: number };
    try {
      uploaded = await this.db.transaction().execute(async (trx) => {
        // The booking row is locked, so parallel uploads are counted one at
        // a time and can't pass the limit of 3 together
        const locked = await trx
          .selectFrom('bookings')
          .select('status')
          .where('id', '=', link.id)
          .forUpdate()
          .executeTakeFirstOrThrow();
        if (locked.status !== 'pending') {
          throw new ApiException(
            409,
            'BOOKING_NOT_PENDING',
            'A proof of payment can only be uploaded while the booking is waiting for its deposit.',
          );
        }
        const count = await trx
          .selectFrom('payment_proofs')
          .select((eb) => eb.fn.countAll<string>().as('n'))
          .where('booking_id', '=', link.id)
          .executeTakeFirstOrThrow();
        if (Number(count.n) >= MAX_PROOFS_PER_BOOKING) throw limitReached();

        const row = await trx
          .insertInto('payment_proofs')
          .values({
            booking_id: link.id,
            storage_key: key,
            original_filename: cleanFilename(file.originalname),
            content_type: contentType,
            size_bytes: file.buffer.length,
            sha256: sha256(file.buffer),
            uploaded_from_ip: ip,
          })
          .returning('uploaded_at')
          .executeTakeFirstOrThrow();
        return {
          uploadedAt: new Date(row.uploaded_at),
          count: Number(count.n) + 1,
        };
      });
    } catch (error) {
      await this.storage.delete('private', key).catch((cleanup: unknown) => {
        this.logger.error(
          `Could not remove the orphaned file ${key}: ${cleanup instanceof Error ? cleanup.message : String(cleanup)}`,
        );
      });
      throw error;
    }

    // Uploading never changes the booking's status or deadline (BR-3, BR-9)
    await this.tellOwner(link.id, uploaded);
    return {
      proof: {
        uploadedAt: isoUtc(uploaded.uploadedAt),
        status: 'received' as const,
        rejectionReason: null,
      },
      proofsRemaining: MAX_PROOFS_PER_BOOKING - uploaded.count,
      message:
        'Thank you. Your booking will be confirmed once the payment reflects in our account.',
    };
  }

  // Cancels the booking for the client (BR-12, docs/api.md 5.3). Whether a
  // refund is due is decided here, once, and recorded.
  async cancel(link: LinkedBooking, now = new Date()) {
    const settings = await this.settings.get();
    const wasConfirmed = link.status === 'confirmed';
    const amount = link.amount_received ?? link.deposit_amount;
    const refundDue =
      wasConfirmed &&
      toCents(link.deposit_amount) > 0 &&
      isRefundable(settings, new Date(link.start_at), now);

    const row = await this.db
      .updateTable('bookings')
      .set({
        status: 'cancelled',
        cancelled_at: now,
        cancelled_by: 'client',
        refund_due: refundDue,
        updated_at: now,
      })
      // Only while the booking is as it was when the link was opened and the
      // appointment hasn't started: a change a moment ago makes this a no-op
      .where('id', '=', link.id)
      .where('status', '=', link.status)
      .where('start_at', '>', now)
      .returning('id')
      .executeTakeFirst();
    if (!row) throw linkNotValid();

    const saved = await this.bookings.findById(link.id);
    if (saved) await this.tellEveryone(saved, link.status);

    const service = await this.db
      .selectFrom('services')
      .select('name')
      .where('id', '=', link.service_id)
      .executeTakeFirstOrThrow();
    const cancelled = { ...link, status: 'cancelled' as const };
    return {
      booking: toBookingSummary(
        { ...cancelled, service_name: service.name },
        [],
        settings.timeZone,
      ),
      refundDue,
      refundAmount: refundDue ? amount : null,
    };
  }

  private async proofCount(bookingId: string): Promise<number> {
    const row = await this.db
      .selectFrom('payment_proofs')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('booking_id', '=', bookingId)
      .executeTakeFirstOrThrow();
    return Number(row.n);
  }

  // Emails never undo or block what the client did (spec section 7)
  private async tellOwner(
    bookingId: string,
    uploaded: { uploadedAt: Date; count: number },
  ): Promise<void> {
    try {
      const booking = await this.bookings.findById(bookingId);
      if (booking) await this.notifier.proofUploaded(booking, uploaded);
    } catch (error) {
      this.logger.error(
        `The proof email for booking ${bookingId} could not be sent: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async tellEveryone(
    booking: Parameters<BookingNotifier['bookingCancelled']>[0],
    previousStatus: LinkedBooking['status'],
  ): Promise<void> {
    const results = await Promise.allSettled([
      this.notifier.bookingCancelled(booking),
      this.notifier.clientCancelled(booking, previousStatus),
    ]);
    for (const result of results) {
      if (result.status === 'rejected') {
        this.logger.error(
          `A cancellation email for ${booking.reference} could not be sent: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
        );
      }
    }
  }
}

const limitReached = () =>
  new ApiException(
    409,
    'PROOF_LIMIT_REACHED',
    `You can upload at most ${MAX_PROOFS_PER_BOOKING} proofs of payment for one booking.`,
  );
