import {
  type BookingCancelledData,
  type PaymentConfirmedData,
  renderBookingCancelled,
  renderPaymentConfirmed,
} from './booking-status-emails.js';

const business = {
  name: 'Make Up by Glory',
  email: 'bookings@example.com',
  phone: null,
};
const summary = {
  reference: 'BK-000123',
  service: 'Soft Glam',
  when: 'Tuesday 13 October 2026 at 09:00',
  endTime: '10:30',
  price: 'R650',
};

describe('renderPaymentConfirmed (4.2a)', () => {
  const data: PaymentConfirmedData = {
    ...summary,
    clientFirstName: 'Sarah',
    business,
    amountReceived: 'R325',
    balance: 'R325',
    refund: {
      kind: 'until',
      cutoff: 'Monday 12 October 2026 at 09:00',
      cutoffHours: 24,
    },
    link: 'https://example.com/booking/NEWTOKEN',
  };

  it('confirms the booking and says the new link replaces the old one', () => {
    const email = renderPaymentConfirmed(data);
    expect(email.subject).toBe(
      "You're booked! Soft Glam on Tuesday 13 October 2026 at 09:00",
    );
    expect(email.text).toContain(
      'Good news: your deposit of R325 has been received and your booking is confirmed.',
    );
    expect(email.text).toContain('The balance of R325 is payable on the day.');
    expect(email.text).toContain(
      'replaces the one in your payment instructions email',
    );
    expect(email.text).toContain('https://example.com/booking/NEWTOKEN');
    expect(email.html).toContain('View or cancel my booking');
  });

  it('shows the refund deadline when deposits are refundable', () => {
    expect(renderPaymentConfirmed(data).text).toContain(
      'Cancel by Monday 12 October 2026 at 09:00 (at least 24 hours before your appointment) and your deposit of R325 will be refunded.',
    );
  });

  it('says so when the refund cut-off has passed', () => {
    const email = renderPaymentConfirmed({
      ...data,
      refund: { kind: 'passed' },
    });
    expect(email.text).toContain("Cancelling now won't refund your deposit.");
    expect(email.text).not.toContain('will be refunded');
  });

  it('says so when deposits are never refundable', () => {
    const email = renderPaymentConfirmed({
      ...data,
      refund: { kind: 'never' },
    });
    expect(email.text).toContain(
      "Please note that deposits aren't refundable.",
    );
    expect(email.text).not.toContain('Cancel by');
  });
});

describe('renderBookingCancelled (4.4)', () => {
  const data: BookingCancelledData = {
    ...summary,
    clientFirstName: 'Sarah',
    business,
    cancelledBy: 'admin',
    refund: { kind: 'none' },
    bookUrl: 'https://example.com/services.html',
  };

  it('has the approved subject and a way to book again', () => {
    const email = renderBookingCancelled(data);
    expect(email.subject).toBe('Your booking BK-000123 has been cancelled');
    expect(email.text).toContain('https://example.com/services.html');
    expect(email.text).toContain('Cancelled booking:');
  });

  it('opens differently for the client and the owner', () => {
    expect(
      renderBookingCancelled({ ...data, cancelledBy: 'client' }).text,
    ).toContain(
      'As requested, your booking has been cancelled and the time released.',
    );
    expect(renderBookingCancelled(data).text).toContain(
      "I'm sorry, but I've had to cancel your booking.",
    );
  });

  it('says a refund is coming when one is due', () => {
    const email = renderBookingCancelled({
      ...data,
      refund: { kind: 'due', amount: 'R325' },
    });
    expect(email.text).toContain(
      "Your deposit of R325 will be refunded. I'll be in touch to arrange it.",
    );
  });

  it('says the deposit is not refundable inside the cut-off', () => {
    const email = renderBookingCancelled({
      ...data,
      cancelledBy: 'client',
      refund: { kind: 'not_refundable', cutoffHours: 24 },
    });
    expect(email.text).toContain(
      "As this was within 24 hours of your appointment, your deposit isn't refundable.",
    );
  });

  it('tells a Pending booking that no deposit was confirmed', () => {
    const email = renderBookingCancelled({
      ...data,
      refund: { kind: 'pending' },
    });
    expect(email.text).toContain(
      'No deposit had been confirmed for this booking.',
    );
  });

  it('leaves the refund line out when there is nothing to say', () => {
    const text = renderBookingCancelled(data).text;
    expect(text).not.toMatch(/refund/i);
    expect(text).not.toContain('No deposit had been confirmed');
  });

  it('carries no booking link (BR-15)', () => {
    expect(renderBookingCancelled(data).text).not.toContain('/booking/');
  });
});
