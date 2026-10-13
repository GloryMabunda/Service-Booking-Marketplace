import { toCents } from '../common/money.js';
import type { BookingStatus } from './booking-status.js';

// The payment status a client sees (docs/api.md, "paymentStatus", C-6). It is
// worked out from the booking and its proofs, never stored. The first rule
// that matches wins.

export type PaymentStatus =
  | 'not_required'
  | 'confirmed'
  | 'expired'
  | 'cancelled'
  | 'proof_received'
  | 'proof_rejected'
  | 'awaiting_payment';

export interface ProofSummary {
  status: 'received' | 'accepted' | 'rejected';
}

export function derivePaymentStatus(booking: {
  status: BookingStatus;
  depositAmount: string;
  paymentVerifiedAt: Date | null;
  proofs: ProofSummary[];
}): PaymentStatus {
  // The deposit is 0: nothing to pay
  if (toCents(booking.depositAmount) === 0) return 'not_required';
  // The owner verified the payment, whatever the booking's status is now
  if (booking.paymentVerifiedAt !== null) return 'confirmed';
  // It ended before payment was confirmed
  if (booking.status === 'expired') return 'expired';
  if (booking.status === 'cancelled') return 'cancelled';

  if (booking.status === 'pending' && booking.proofs.length > 0) {
    // Waiting for the owner's bank check
    if (booking.proofs.some((p) => p.status !== 'rejected'))
      return 'proof_received';
    // Every proof so far was rejected: the client can upload another
    return 'proof_rejected';
  }
  return 'awaiting_payment';
}
