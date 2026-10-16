import { type BookingSummaryData, locationRows } from './booking-emails.js';
import {
  type Block,
  type Business,
  clientFooter,
  renderEmail,
} from './email-layout.js';
import type { RenderedEmail } from './payment-instructions.template.js';

// The emails that follow a status change (docs/emails.md 4.2a and 4.4). Every
// value is already formatted; this file only holds the approved wording.

function summary(d: BookingSummaryData): Block {
  return {
    rows: [
      ['Booking reference', d.reference],
      ['Service', d.service],
      ['When', `${d.when} (until ${d.endTime})`],
      ...locationRows(d),
      ['Price', d.price],
    ],
  };
}

// What the settings say about refunding the deposit if plans change (BR-12)
export type ConfirmedRefund =
  | { kind: 'until'; cutoff: string; cutoffHours: number }
  | { kind: 'passed' }
  | { kind: 'never' };

// 4.2a: the owner confirmed the deposit. The new booking link replaces the one
// in the payment instructions (BR-15).
export interface PaymentConfirmedData extends BookingSummaryData {
  clientFirstName: string;
  business: Business;
  amountReceived: string;
  balance: string;
  refund: ConfirmedRefund;
  link: string;
}

export function renderPaymentConfirmed(d: PaymentConfirmedData): RenderedEmail {
  let refundLine: string;
  if (d.refund.kind === 'until') {
    refundLine = `Plans changed? Cancel by ${d.refund.cutoff} (at least ${d.refund.cutoffHours} hours before your appointment) and your deposit of ${d.amountReceived} will be refunded.`;
  } else if (d.refund.kind === 'passed') {
    refundLine = "Cancelling now won't refund your deposit.";
  } else {
    refundLine = "Please note that deposits aren't refundable.";
  }
  return renderEmail(
    `You're booked! ${d.service} on ${d.when}`,
    [
      { p: `Hi ${d.clientFirstName},` },
      {
        p: `Good news: your deposit of ${d.amountReceived} has been received and your booking is confirmed.`,
      },
      summary(d),
      { p: `The balance of ${d.balance} is payable on the day.` },
      { p: refundLine },
      { button: { label: 'View or cancel my booking', url: d.link } },
      {
        p: "This is your private booking link; it replaces the one in your payment instructions email, which no longer works. Please keep this email and don't share the link.",
      },
      { p: `I'm looking forward to seeing you!\n${d.business.name}` },
    ],
    clientFooter(d.business),
  );
}

// The refund line of the cancellation email
export type CancelledRefund =
  | { kind: 'due'; amount: string }
  | { kind: 'not_refundable'; cutoffHours: number }
  | { kind: 'pending' }
  | { kind: 'none' };

// 4.4: the booking was cancelled, by the client or by the owner
export interface BookingCancelledData extends BookingSummaryData {
  clientFirstName: string;
  business: Business;
  cancelledBy: 'client' | 'admin';
  refund: CancelledRefund;
  bookUrl: string;
}

export function renderBookingCancelled(d: BookingCancelledData): RenderedEmail {
  const opening =
    d.cancelledBy === 'client'
      ? 'As requested, your booking has been cancelled and the time released.'
      : "I'm sorry, but I've had to cancel your booking. Please reply to this email if you'd like to arrange another time.";
  let refundLine: string | null = null;
  if (d.refund.kind === 'due') {
    refundLine = `Your deposit of ${d.refund.amount} will be refunded. I'll be in touch to arrange it.`;
  } else if (d.refund.kind === 'not_refundable') {
    refundLine = `As this was within ${d.refund.cutoffHours} hours of your appointment, your deposit isn't refundable.`;
  } else if (d.refund.kind === 'pending') {
    refundLine =
      "No deposit had been confirmed for this booking. If you've already paid, please reply to this email and I'll sort it out.";
  }
  const blocks: Block[] = [
    { p: `Hi ${d.clientFirstName},` },
    { p: opening },
    { p: 'Cancelled booking:' },
    summary(d),
  ];
  if (refundLine) blocks.push({ p: refundLine });
  blocks.push(
    { p: `You're welcome to book again any time: ${d.bookUrl}` },
    { p: d.business.name },
  );
  return renderEmail(
    `Your booking ${d.reference} has been cancelled`,
    blocks,
    clientFooter(d.business),
  );
}
