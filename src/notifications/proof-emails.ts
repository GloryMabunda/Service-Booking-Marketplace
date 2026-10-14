import { type Business, clientFooter, renderEmail } from './email-layout.js';
import type { RenderedEmail } from './payment-instructions.template.js';

// The email that tells a client their proof of payment wasn't accepted
// (docs/emails.md 4.3, BR-14). Every value is already formatted; this file
// only holds the approved wording.
//
// It never contains a booking link: the client is pointed to the link in their
// original payment instructions email, or to the Find my booking page to ask
// for a new one (BR-14).
export interface ProofRejectedData {
  clientFirstName: string;
  business: Business;
  reference: string;
  service: string;
  when: string;
  reason: string; // the owner's text, shown exactly as written
  deposit: string;
  deadline: string;
  lookupUrl: string;
}

export function renderProofRejected(d: ProofRejectedData): RenderedEmail {
  return renderEmail(
    `Please check your proof of payment for ${d.reference}`,
    [
      { p: `Hi ${d.clientFirstName},` },
      {
        p: `Thank you for sending your proof of payment for ${d.service} on ${d.when}. Unfortunately I couldn't accept it:`,
      },
      { callout: `"${d.reason}"` },
      {
        p: `Please upload a new proof of payment using the booking link in your payment instructions email. If you can't find it, request a new link from your booking details page: ${d.lookupUrl}`,
      },
      {
        p: `Your deposit of ${d.deposit} is still due by ${d.deadline}. If it isn't received by then, the booking expires.`,
      },
      { p: 'If you think this is a mistake, just reply to this email.' },
      { p: 'Thank you,\nGlory' },
    ],
    clientFooter(d.business),
  );
}
