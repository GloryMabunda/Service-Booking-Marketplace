import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { ApiException } from '../common/api-error.js';
import { DATABASE } from '../database/database.module.js';
import type { DB } from '../database/database.types.js';
import {
  FILE_STORAGE,
  type FileStorage,
  StoredFileNotFoundError,
} from '../storage/file-storage.js';
import { AdminBookingsService } from './admin-bookings.service.js';
import { BOOKING_NOTIFIER, type BookingNotifier } from './booking-notifier.js';
import { BookingsRepository } from './bookings.repository.js';
import type { ProofContentType } from './proof-file.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXTENSIONS: Record<ProofContentType, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

const notFound = () =>
  new ApiException(404, 'NOT_FOUND', 'Proof of payment not found.');

// A proof file ready to send to the owner
export interface ProofFile {
  data: Buffer;
  contentType: ProofContentType;
  // A safe name built from the booking reference, never the uploaded filename
  filename: string;
}

// The owner's work on proofs of payment (A-9, BR-14, docs/api.md 7.9 and 7.10).
@Injectable()
export class AdminProofsService {
  private readonly logger = new Logger(AdminProofsService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    private readonly bookings: BookingsRepository,
    private readonly adminBookings: AdminBookingsService,
    @Inject(BOOKING_NOTIFIER) private readonly notifier: BookingNotifier,
  ) {}

  // The stored file of a proof. 410 once the retention job has deleted it.
  async file(id: string): Promise<ProofFile> {
    const proof = await this.find(id);
    if (proof.file_deleted_at) {
      throw new ApiException(
        410,
        'FILE_DELETED',
        'This proof of payment file was removed after the retention period.',
      );
    }
    // "BK-000123-proof-2.pdf": the booking's reference and this proof's place
    // among its proofs
    const siblings = await this.db
      .selectFrom('payment_proofs')
      .select('id')
      .where('booking_id', '=', proof.booking_id)
      .orderBy('uploaded_at')
      .orderBy('id')
      .execute();
    const booking = await this.db
      .selectFrom('bookings')
      .select('reference')
      .where('id', '=', proof.booking_id)
      .executeTakeFirstOrThrow();
    const position = siblings.findIndex((s) => s.id === proof.id) + 1;
    const contentType = proof.content_type as ProofContentType;

    let data: Buffer;
    try {
      data = await this.storage.read('private', proof.storage_key);
    } catch (error) {
      if (error instanceof StoredFileNotFoundError) {
        throw new ApiException(
          410,
          'FILE_DELETED',
          'This proof of payment file is no longer available.',
        );
      }
      throw error;
    }
    return {
      data,
      contentType,
      filename: `${booking.reference}-proof-${position}.${EXTENSIONS[contentType] ?? 'bin'}`,
    };
  }

  // Accepts or rejects a proof and records who and when. Accepting does not
  // confirm the booking: that is a separate step after the bank check (BR-8).
  // Rejecting emails the client the reason, without a booking link.
  async review(
    id: string,
    change:
      { status: 'accepted' } | { status: 'rejected'; rejectionReason: string },
    adminId: string,
    now = new Date(),
  ) {
    const proof = await this.find(id);
    const row = await this.db
      .updateTable('payment_proofs')
      .set({
        status: change.status,
        rejection_reason:
          change.status === 'rejected' ? change.rejectionReason : null,
        reviewed_at: now,
        reviewed_by: adminId,
      })
      .where('id', '=', id)
      // Only a proof still awaiting review: two reviews at once can't both win
      .where('status', '=', 'received')
      .returning('id')
      .executeTakeFirst();
    if (!row) {
      throw new ApiException(
        409,
        'PROOF_ALREADY_REVIEWED',
        'This proof of payment has already been reviewed.',
      );
    }

    // The client is told only while the booking still waits for its deposit:
    // a proof rejected on a booking that is already confirmed or finished
    // needs no new upload
    let emailSentTo: string | null | undefined;
    if (change.status === 'rejected') {
      emailSentTo = await this.tellClient(
        proof.booking_id,
        change.rejectionReason,
      );
    }

    const detail = await this.adminBookings.get(proof.booking_id);
    const reviewed = detail.proofs.find((p) => p.id === id);
    return {
      proof: reviewed,
      ...(emailSentTo !== undefined ? { emailSentTo } : {}),
    };
  }

  private async tellClient(
    bookingId: string,
    reason: string,
  ): Promise<string | null> {
    try {
      const booking = await this.bookings.findById(bookingId);
      if (!booking || booking.status !== 'pending') return null;
      const sent = await this.notifier.proofRejected(booking, reason);
      return sent ? booking.clientEmail : null;
    } catch (error) {
      this.logger.error(
        `The proof rejection email for booking ${bookingId} could not be sent: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  private async find(id: string) {
    const proof = UUID.test(id)
      ? await this.db
          .selectFrom('payment_proofs')
          .selectAll()
          .where('id', '=', id)
          .executeTakeFirst()
      : undefined;
    if (!proof) throw notFound();
    return proof;
  }
}
