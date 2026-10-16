import { renderProofRejected } from './proof-emails.js';

const email = renderProofRejected({
  clientFirstName: 'Sarah',
  business: {
    name: 'Fresh Start Home Services',
    email: 'bookings@example.com',
    phone: null,
  },
  reference: 'BK-000123',
  service: 'Standard Clean',
  when: 'Tuesday 13 October 2026 at 09:00',
  reason: 'The amount does not match the deposit.',
  deposit: 'R325',
  deadline: 'Monday 12 October 2026 at 14:00',
  lookupUrl: 'https://example.com/lookup.html',
});

describe('renderProofRejected (4.3)', () => {
  it('has the approved subject', () => {
    expect(email.subject).toBe(
      'Please check your proof of payment for BK-000123',
    );
  });

  it('gives the owner’s reason exactly as written', () => {
    expect(email.text).toContain('"The amount does not match the deposit."');
    expect(email.html).toContain('The amount does not match the deposit.');
  });

  it('says the deposit is still due, and when', () => {
    expect(email.text).toContain(
      "Your deposit of R325 is still due by Monday 12 October 2026 at 14:00. If it isn't received by then, the booking expires.",
    );
  });

  it('points to the Find my booking page and carries no booking link', () => {
    expect(email.text).toContain('https://example.com/lookup.html');
    expect(email.text).not.toContain('/booking/');
    expect(email.html).not.toContain('/booking/');
  });

  it('does not let the reason inject markup', () => {
    const html = renderProofRejected({
      clientFirstName: 'Sarah',
      business: { name: 'B', email: 'b@example.com', phone: null },
      reference: 'BK-000123',
      service: 'S',
      when: 'W',
      reason: '<script>alert(1)</script>',
      deposit: 'R1',
      deadline: 'D',
      lookupUrl: 'https://example.com/lookup.html',
    }).html;
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
