import type { BankingDetails } from '../settings/settings.schema.js';
import { escapeHtml } from './email-format.js';

// The "payment instructions" email (docs/emails.md 4.1, #56). Every value is
// already formatted; this file only holds the approved wording.
export interface PaymentInstructionsData {
  clientFirstName: string;
  business: { name: string; email: string; phone: string | null };
  reference: string;
  service: string;
  when: string;
  endTime: string;
  price: string;
  deposit: string;
  balance: string;
  deadline: string;
  bank: BankingDetails;
  // The private booking link. This email is the only place it appears (BR-15).
  link: string;
  // A new link was asked for: the email says so and the old link is dead
  newLink?: boolean;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

const NOT_CONFIRMED =
  "Your booking is not confirmed yet. It's confirmed only once your deposit reflects in my bank account.";

export function renderPaymentInstructions(
  d: PaymentInstructionsData,
): RenderedEmail {
  const contact = [d.business.email, d.business.phone]
    .filter(Boolean)
    .join(' · ');
  const summary = [
    ['Booking reference', d.reference],
    ['Service', d.service],
    ['When', `${d.when} (until ${d.endTime})`],
    ['Price', d.price],
  ];
  const bank = [
    ['Account name', d.bank.accountName],
    ['Bank', d.bank.bank],
    ['Account number', d.bank.accountNumber],
    ['Branch code', d.bank.branchCode],
    ['Account type', d.bank.accountType],
    ['Reference', d.reference],
  ];

  const intro = d.newLink
    ? "As requested, here's a new private link for your booking. Your previous link no longer works."
    : `Thank you for booking with ${d.business.name}! I've reserved this time for you:`;

  const text = [
    `Hi ${d.clientFirstName},`,
    '',
    intro,
    '',
    ...summary.map(([label, value]) => `${label}: ${value}`),
    '',
    NOT_CONFIRMED,
    '',
    `1. Pay your deposit of ${d.deposit} by ${d.deadline}`,
    '',
    ...bank.map(([label, value]) => `   ${`${label}:`.padEnd(17)}${value}`),
    '',
    `   Please use ${d.reference} as your payment reference so I can match your payment.`,
    '',
    '2. Upload your proof of payment',
    '',
    `   ${d.link}`,
    '',
    '   This is your private booking link. Keep this email: you can also use the',
    "   link to cancel if your plans change. Please don't share it.",
    '',
    "3. I'll confirm your booking by email as soon as the money reflects in my account.",
    '',
    `If the deposit isn't received by ${d.deadline}, the booking expires and the time is released for other clients.`,
    '',
    `The balance of ${d.balance} is payable on the day.`,
    '',
    `Can't use the upload link? Email your proof of payment to ${d.business.email} with your reference ${d.reference}.`,
    '',
    'See you soon,',
    'Glory',
    '',
    '--',
    d.business.name,
    contact,
    '',
    'Questions? Just reply to this email.',
    `You're receiving this because you made a booking with ${d.business.name}.`,
  ].join('\n');

  const rows = (items: string[][]) =>
    items
      .map(
        ([label, value]) =>
          `<tr><td style="padding:2px 12px 2px 0;color:#6b5a66">${escapeHtml(label)}</td><td style="padding:2px 0"><strong>${escapeHtml(value)}</strong></td></tr>`,
      )
      .join('');
  const heading = 'font-size:18px;color:#A02080;margin:24px 0 8px';
  const html = `<!doctype html>
<html lang="en"><body style="margin:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#2A1A26;line-height:1.5">
<div style="max-width:600px;margin:0 auto;padding:24px 16px">
<p>Hi ${escapeHtml(d.clientFirstName)},</p>
<p>${escapeHtml(intro)}</p>
<table role="presentation" style="border-collapse:collapse;margin:0 0 16px">${rows(summary)}</table>
<p style="border-left:4px solid #A02080;padding:8px 12px;background:#faf2f8"><strong>${escapeHtml(NOT_CONFIRMED)}</strong></p>
<h2 style="${heading}">1. Pay your deposit of ${escapeHtml(d.deposit)} by ${escapeHtml(d.deadline)}</h2>
<table role="presentation" style="border-collapse:collapse;margin:0 0 8px">${rows(bank)}</table>
<p>Please use <strong>${escapeHtml(d.reference)}</strong> as your payment reference so I can match your payment.</p>
<h2 style="${heading}">2. Upload your proof of payment</h2>
<p><a href="${escapeHtml(d.link)}" style="display:inline-block;background:#FFA040;color:#2A1A26;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:6px">Upload proof of payment</a></p>
<p>This is your private booking link. Keep this email: you can also use the link to cancel if your plans change. Please don't share it.</p>
<h2 style="${heading}">3. I'll confirm your booking</h2>
<p>I'll confirm your booking by email as soon as the money reflects in my account.</p>
<p>If the deposit isn't received by ${escapeHtml(d.deadline)}, the booking expires and the time is released for other clients.</p>
<p>The balance of ${escapeHtml(d.balance)} is payable on the day.</p>
<p>Can't use the upload button? Email your proof of payment to <a href="mailto:${escapeHtml(d.business.email)}" style="color:#A02080">${escapeHtml(d.business.email)}</a> with your reference ${escapeHtml(d.reference)}.</p>
<p>See you soon,<br>Glory</p>
<hr style="border:0;border-top:1px solid #e6d9e2;margin:24px 0">
<p style="font-size:13px;color:#6b5a66">${escapeHtml(d.business.name)}<br>${escapeHtml(contact)}<br><br>Questions? Just reply to this email.<br>You're receiving this because you made a booking with ${escapeHtml(d.business.name)}.</p>
</div></body></html>`;

  return {
    subject: d.newLink
      ? `Your new booking link for ${d.reference}`
      : `Your booking request ${d.reference}: please pay your deposit`,
    text,
    html,
  };
}
