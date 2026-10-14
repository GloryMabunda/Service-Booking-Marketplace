import { Injectable } from '@nestjs/common';

// How a deposit is confirmed (BR-8). Bookings only know this interface, so a
// payment gateway can replace manual EFT later without changing booking logic.
export interface PaymentConfirmation {
  amountReceived: string; // "325.00"
  verifiedAt: Date;
  verifiedBy: string; // the administrator's user id
}

export interface PaymentProvider {
  // Confirms that `amountReceived` reached the business account. Throws if the
  // provider can't confirm it.
  confirmPayment(input: {
    bookingId: string;
    amountReceived: string;
    confirmedBy: string;
    now: Date;
  }): Promise<PaymentConfirmation>;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

// Manual EFT: the client paid by bank transfer and the owner has already seen
// the money in her bank account, so confirming is her word (BR-8). Nothing is
// read from a proof of payment, which can be forged.
@Injectable()
export class ManualEftProvider implements PaymentProvider {
  confirmPayment(input: {
    amountReceived: string;
    confirmedBy: string;
    now: Date;
  }): Promise<PaymentConfirmation> {
    return Promise.resolve({
      amountReceived: input.amountReceived,
      verifiedAt: input.now,
      verifiedBy: input.confirmedBy,
    });
  }
}
