import {
  renderAdminNewBooking,
  renderBookingExpired,
  renderConfirmedNoDeposit,
} from './booking-emails.js';

const business = {
  name: 'Fresh Start Home Services',
  email: 'bookings@example.com',
  phone: null,
};
const summary = {
  reference: 'BK-000123',
  service: 'Standard Clean',
  when: 'Tuesday 13 October 2026 at 09:00',
  endTime: '10:30',
  price: 'R650',
};

describe('renderConfirmedNoDeposit (4.2b)', () => {
  const data = {
    ...summary,
    clientFirstName: 'Sarah',
    business,
    link: 'https://example.com/booking/TOKEN',
    newLink: false,
  };

  it('confirms the booking and holds the link', () => {
    const email = renderConfirmedNoDeposit(data);
    expect(email.subject).toBe(
      "You're booked! Standard Clean on Tuesday 13 October 2026 at 09:00",
    );
    expect(email.text).toContain(
      'Thank you for booking with Fresh Start Home Services! Your booking is confirmed.',
    );
    expect(email.text).toContain('https://example.com/booking/TOKEN');
    expect(email.html).toContain('href="https://example.com/booking/TOKEN"');
    expect(email.text).not.toMatch(/deposit/i);
  });

  it('has a new-link variant', () => {
    const email = renderConfirmedNoDeposit({ ...data, newLink: true });
    expect(email.subject).toBe('Your new booking link for BK-000123');
    expect(email.text).toContain(
      "As requested, here's a new private link for your booking. Your previous link no longer works.",
    );
    expect(email.text).not.toContain('Thank you for booking');
  });
});

describe('renderBookingExpired (4.5)', () => {
  const email = renderBookingExpired({
    clientFirstName: 'Sarah',
    business,
    reference: 'BK-000123',
    service: 'Standard Clean',
    when: 'Tuesday 13 October 2026 at 09:00',
    deadline: 'Monday 12 October 2026 at 14:00',
    bookUrl: 'https://example.com/services.html',
  });

  it('says the time was released and offers to book again', () => {
    expect(email.subject).toBe('Your booking request BK-000123 has expired');
    expect(email.text).toContain(
      "I didn't receive your deposit for Standard Clean on Tuesday 13 October 2026 at 09:00 by Monday 12 October 2026 at 14:00, so the booking has expired and the time has been released.",
    );
    expect(email.text).toContain('https://example.com/services.html');
  });

  it('offers a way out if the client did pay', () => {
    expect(email.text).toContain("If you've already paid");
  });

  it('holds no booking link', () => {
    expect(email.text).not.toContain('/booking/');
  });
});

describe('renderAdminNewBooking (5.1)', () => {
  const data = {
    ...summary,
    clientName: 'Sarah Mokoena',
    clientEmail: 'sarah@example.com',
    clientPhone: '+27821234567',
    deposit: { amount: 'R325', deadline: 'Monday 12 October 2026 at 14:00' },
    notes: 'Birthday makeup',
    portalUrl: 'https://example.com/admin/bookings/abc',
  };

  it('lists the client, the booking and the deposit', () => {
    const email = renderAdminNewBooking(data);
    expect(email.subject).toBe(
      'New booking: Sarah Mokoena, Standard Clean, Tuesday 13 October 2026 at 09:00',
    );
    for (const part of [
      'New booking BK-000123',
      'Sarah Mokoena',
      'sarah@example.com',
      '+27821234567',
      'Standard Clean',
      'R325, due by Monday 12 October 2026 at 14:00',
      'Pending (awaiting deposit)',
      'Birthday makeup',
      'https://example.com/admin/bookings/abc',
    ]) {
      expect(email.text).toContain(part);
    }
  });

  it('leaves out the deposit and the empty notes, and says Confirmed', () => {
    const email = renderAdminNewBooking({
      ...data,
      deposit: null,
      notes: null,
    });
    expect(email.text).toContain('Confirmed (no deposit)');
    expect(email.text).not.toContain('Deposit');
    expect(email.text).not.toContain('Notes');
  });

  it('escapes what the client typed', () => {
    const email = renderAdminNewBooking({
      ...data,
      notes: '<script>alert(1)</script>',
    });
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
  });
});
