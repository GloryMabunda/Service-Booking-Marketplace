import {
  type ClientCancelledData,
  renderAdminClientCancelled,
  renderAdminProofUploaded,
} from './admin-emails.js';

describe('renderAdminProofUploaded (5.2)', () => {
  const email = renderAdminProofUploaded({
    clientName: 'Sarah Mokoena',
    reference: 'BK-000123',
    service: 'Standard Clean',
    when: 'Tuesday 13 October 2026 at 09:00',
    deposit: 'R325',
    deadline: 'Monday 12 October 2026 at 14:00',
    uploadedAt: 'Saturday 10 October 2026 at 15:40',
    count: '2 of 3',
    portalUrl: 'https://example.com/admin/booking.html?id=abc',
  });

  it('has the approved subject', () => {
    expect(email.subject).toBe(
      'Proof of payment uploaded: BK-000123, Sarah Mokoena',
    );
  });

  it('gives the reference, client, deposit, deadline and a link to the booking', () => {
    for (const part of [
      'Sarah Mokoena uploaded a proof of payment for BK-000123.',
      'Standard Clean, Tuesday 13 October 2026 at 09:00',
      'R325',
      'Monday 12 October 2026 at 14:00',
      'Saturday 10 October 2026 at 15:40 (2 of 3)',
      'https://example.com/admin/booking.html?id=abc',
    ]) {
      expect(email.text).toContain(part);
    }
    expect(email.html).toContain('Review proof');
  });

  it('reminds the owner to check the bank before confirming', () => {
    expect(email.text).toContain(
      "A proof of payment alone isn't enough: proofs can be faked and payments reversed.",
    );
  });

  it('carries no client booking link', () => {
    expect(email.text).not.toMatch(/\/booking\/[\w-]{43}/);
  });
});

describe('renderAdminClientCancelled (5.3)', () => {
  const data: ClientCancelledData = {
    clientName: 'Sarah Mokoena',
    clientEmail: 'sarah@example.com',
    clientPhone: '+27821234567',
    reference: 'BK-000123',
    service: 'Standard Clean',
    when: 'Tuesday 13 October 2026 at 09:00',
    previousStatus: 'Confirmed',
    refund: { kind: 'due', amount: 'R325' },
    portalUrl: 'https://example.com/admin/booking.html?id=abc',
  };

  it('flags a refund due in the subject and the body', () => {
    const email = renderAdminClientCancelled(data);
    expect(email.subject).toBe('Refund due: Sarah Mokoena cancelled BK-000123');
    expect(email.text).toContain('Refund due: R325.');
    expect(email.text).toContain('Record refund paid');
    expect(email.text).toContain('Status before cancelling: Confirmed');
    expect(email.text).toContain('sarah@example.com · +27821234567');
  });

  it.each([
    [
      { kind: 'outside_rule' } as const,
      'No refund is due: they cancelled after the refund cut-off.',
    ],
    [{ kind: 'pending' } as const, 'No deposit had been confirmed.'],
  ])('says so for %j', (refund, line) => {
    const email = renderAdminClientCancelled({ ...data, refund });
    expect(email.subject).toBe('Cancelled: Sarah Mokoena, BK-000123');
    expect(email.text).toContain(line);
    expect(email.text).not.toContain('Refund due');
  });

  it('leaves the refund block out when there is nothing to say', () => {
    const email = renderAdminClientCancelled({
      ...data,
      refund: { kind: 'none' },
    });
    expect(email.text).not.toMatch(/refund/i);
    expect(email.text).toContain(
      'The time has been released for other bookings.',
    );
  });
});
