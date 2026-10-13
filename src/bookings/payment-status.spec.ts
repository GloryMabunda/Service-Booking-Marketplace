import { derivePaymentStatus, type PaymentStatus } from './payment-status.js';
import type { BookingStatus } from './booking-status.js';

const base = {
  status: 'pending' as BookingStatus,
  depositAmount: '325.00',
  paymentVerifiedAt: null as Date | null,
  proofs: [] as { status: 'received' | 'accepted' | 'rejected' }[],
};
const status = (changes: Partial<typeof base>): PaymentStatus =>
  derivePaymentStatus({ ...base, ...changes });

// The table in docs/api.md, first match wins
describe('derivePaymentStatus', () => {
  it('is awaiting_payment for a Pending booking with no proof', () => {
    expect(status({})).toBe('awaiting_payment');
  });

  it('is not_required when the deposit is 0, whatever else is true', () => {
    expect(status({ depositAmount: '0.00', status: 'confirmed' })).toBe(
      'not_required',
    );
    expect(status({ depositAmount: '0.00', status: 'cancelled' })).toBe(
      'not_required',
    );
    expect(
      status({ depositAmount: '0.00', paymentVerifiedAt: new Date() }),
    ).toBe('not_required');
  });

  it('is confirmed once the owner verified the payment, whatever the status is now', () => {
    const verified = new Date();
    for (const s of [
      'confirmed',
      'completed',
      'no_show',
      'cancelled',
    ] as const) {
      expect(status({ status: s, paymentVerifiedAt: verified })).toBe(
        'confirmed',
      );
    }
  });

  it('is expired or cancelled when the booking ended before payment was confirmed', () => {
    expect(status({ status: 'expired' })).toBe('expired');
    expect(status({ status: 'cancelled' })).toBe('cancelled');
  });

  it('puts expired and cancelled ahead of a proof', () => {
    const proofs = [{ status: 'received' as const }];
    expect(status({ status: 'expired', proofs })).toBe('expired');
    expect(status({ status: 'cancelled', proofs })).toBe('cancelled');
  });

  describe('proofs on a Pending booking', () => {
    it('is proof_received while a proof waits for the owner (received or accepted)', () => {
      expect(status({ proofs: [{ status: 'received' }] })).toBe(
        'proof_received',
      );
      expect(status({ proofs: [{ status: 'accepted' }] })).toBe(
        'proof_received',
      );
    });

    it('is proof_received if any proof is not rejected, even after a rejected one', () => {
      expect(
        status({ proofs: [{ status: 'rejected' }, { status: 'received' }] }),
      ).toBe('proof_received');
    });

    it('is proof_rejected when every proof so far was rejected', () => {
      expect(status({ proofs: [{ status: 'rejected' }] })).toBe(
        'proof_rejected',
      );
      expect(
        status({ proofs: [{ status: 'rejected' }, { status: 'rejected' }] }),
      ).toBe('proof_rejected');
    });
  });

  it('is awaiting_payment for a Confirmed booking that has no verified payment on record', () => {
    expect(status({ status: 'confirmed' })).toBe('awaiting_payment');
  });
});
