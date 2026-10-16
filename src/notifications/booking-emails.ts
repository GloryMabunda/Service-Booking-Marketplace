import {
  type Block,
  type Business,
  clientFooter,
  ownerFooter,
  renderEmail,
} from './email-layout.js';
import type { RenderedEmail } from './payment-instructions.template.js';

// The other booking emails (docs/emails.md 4.2b, 4.5 and 5.1). Every value is
// already formatted; this file only holds the approved wording.

export interface BookingSummaryData {
  reference: string;
  service: string;
  when: string;
  endTime: string;
  price: string;
  // Where the appointment is, and the travel fee when it is at the client's
  // place (#115); the owner's address appears only in emails to her clients
  where?: string;
  travelFee?: string;
}

export function locationRows(d: {
  where?: string;
  travelFee?: string;
}): [string, string][] {
  const rows: [string, string][] = [];
  if (d.where) rows.push(['Where', d.where]);
  if (d.travelFee) rows.push(['Travel fee', d.travelFee]);
  return rows;
}

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

// 4.2b: a booking made while no deposit is needed, or a new link for a
// Confirmed booking. The link is only in this email (BR-15).
export interface NoDepositData extends BookingSummaryData {
  clientFirstName: string;
  business: Business;
  link: string;
  newLink: boolean;
}

export function renderConfirmedNoDeposit(d: NoDepositData): RenderedEmail {
  return renderEmail(
    d.newLink
      ? `Your new booking link for ${d.reference}`
      : `You're booked! ${d.service} on ${d.when}`,
    [
      { p: `Hi ${d.clientFirstName},` },
      {
        p: d.newLink
          ? "As requested, here's a new private link for your booking. Your previous link no longer works."
          : `Thank you for booking with ${d.business.name}! Your booking is confirmed.`,
      },
      summary(d),
      {
        p: 'Your private booking link lets you see your booking and cancel if your plans change:',
      },
      { button: { label: 'View my booking', url: d.link } },
      { p: "Please keep this email and don't share the link." },
      { p: `See you soon,\n${d.business.name}` },
    ],
    clientFooter(d.business),
  );
}

// 4.5: the deposit wasn't received in time
export interface ExpiredData {
  clientFirstName: string;
  business: Business;
  reference: string;
  service: string;
  when: string;
  deadline: string;
  bookUrl: string;
}

export function renderBookingExpired(d: ExpiredData): RenderedEmail {
  return renderEmail(
    `Your booking request ${d.reference} has expired`,
    [
      { p: `Hi ${d.clientFirstName},` },
      {
        p: `I didn't receive your deposit for ${d.service} on ${d.when} by ${d.deadline}, so the booking has expired and the time has been released.`,
      },
      {
        p: "If you've already paid, please reply to this email with your proof of payment and I'll sort it out.",
      },
      { p: `You're welcome to book again: ${d.bookUrl}` },
      { p: d.business.name },
    ],
    clientFooter(d.business),
  );
}

// 5.1: tells the owner about every new booking
export interface AdminNewBookingData extends BookingSummaryData {
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  // null when no deposit is needed
  deposit: { amount: string; deadline: string } | null;
  notes: string | null;
  portalUrl: string;
}

export function renderAdminNewBooking(d: AdminNewBookingData): RenderedEmail {
  const rows: [string, string][] = [
    ['Client', d.clientName],
    ['Email', d.clientEmail],
    ['Phone', d.clientPhone],
    ['Service', d.service],
    ['When', `${d.when} (until ${d.endTime})`],
    ...locationRows(d),
    ['Price', d.price],
  ];
  if (d.deposit) {
    rows.push(['Deposit', `${d.deposit.amount}, due by ${d.deposit.deadline}`]);
  }
  rows.push([
    'Status',
    d.deposit ? 'Pending (awaiting deposit)' : 'Confirmed (no deposit)',
  ]);
  if (d.notes) rows.push(['Notes', d.notes]);

  return renderEmail(
    `New booking: ${d.clientName}, ${d.service}, ${d.when}`,
    [
      { p: `New booking ${d.reference}` },
      { rows },
      { button: { label: 'Open booking', url: d.portalUrl } },
    ],
    ownerFooter(d.portalUrl),
  );
}
