import { type Block, ownerFooter, renderEmail } from './email-layout.js';
import type { RenderedEmail } from './payment-instructions.template.js';

// Emails to the owner about what a client did (docs/emails.md 5.2 and 5.3).
// Every value is already formatted; this file only holds the approved wording.
// They never carry the client's booking link: the button opens the booking in
// the portal (BR-15).

// 5.2: a client uploaded a proof of payment (BR-14)
export interface ProofUploadedData {
  clientName: string;
  reference: string;
  service: string;
  when: string;
  deposit: string;
  deadline: string;
  uploadedAt: string;
  count: string; // "2 of 3"
  portalUrl: string;
}

export function renderAdminProofUploaded(d: ProofUploadedData): RenderedEmail {
  return renderEmail(
    `Proof of payment uploaded: ${d.reference}, ${d.clientName}`,
    [
      {
        p: `${d.clientName} uploaded a proof of payment for ${d.reference}.`,
      },
      {
        rows: [
          ['Service', `${d.service}, ${d.when}`],
          ['Deposit', d.deposit],
          ['Deadline', d.deadline],
          ['Uploaded', `${d.uploadedAt} (${d.count})`],
        ],
      },
      {
        p: `Before confirming, check that ${d.deposit} has reflected in your bank account. A proof of payment alone isn't enough: proofs can be faked and payments reversed.`,
      },
      { button: { label: 'Review proof', url: d.portalUrl } },
      {
        p: 'The booking still expires at the deadline unless you confirm payment or extend the deadline.',
      },
    ],
    ownerFooter(d.portalUrl),
  );
}

// 5.3: a client cancelled through their booking link (C-8, BR-12)
export type ClientCancelRefund =
  | { kind: 'due'; amount: string }
  | { kind: 'outside_rule' }
  | { kind: 'pending' }
  | { kind: 'none' };

export interface ClientCancelledData {
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  reference: string;
  service: string;
  when: string;
  previousStatus: string; // "Confirmed" or "Pending"
  refund: ClientCancelRefund;
  portalUrl: string;
}

export function renderAdminClientCancelled(
  d: ClientCancelledData,
): RenderedEmail {
  const refundDue = d.refund.kind === 'due';
  const blocks: Block[] = [
    { p: `${d.clientName} cancelled their booking ${d.reference}.` },
    {
      rows: [
        ['Service', `${d.service}, ${d.when}`],
        ['Status before cancelling', d.previousStatus],
        ['Client', `${d.clientEmail} · ${d.clientPhone}`],
      ],
    },
  ];
  if (d.refund.kind === 'due') {
    blocks.push({
      callout: `Refund due: ${d.refund.amount}. They cancelled before the refund cut-off. Pay the refund, then record it in the portal (Record refund paid).`,
    });
  } else if (d.refund.kind === 'outside_rule') {
    blocks.push({
      p: 'No refund is due: they cancelled after the refund cut-off.',
    });
  } else if (d.refund.kind === 'pending') {
    blocks.push({
      p: 'No deposit had been confirmed. If they had already paid, check your bank and refund them manually.',
    });
  }
  blocks.push(
    { p: 'The time has been released for other bookings.' },
    { button: { label: 'Open booking', url: d.portalUrl } },
  );
  return renderEmail(
    refundDue
      ? `Refund due: ${d.clientName} cancelled ${d.reference}`
      : `Cancelled: ${d.clientName}, ${d.reference}`,
    blocks,
    ownerFooter(d.portalUrl),
  );
}
