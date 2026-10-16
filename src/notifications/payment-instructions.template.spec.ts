import { escapeHtml } from './email-format.js';
import {
  type PaymentInstructionsData,
  renderPaymentInstructions,
} from './payment-instructions.template.js';

const data: PaymentInstructionsData = {
  clientFirstName: 'Sarah',
  business: {
    name: 'Fresh Start',
    email: 'bookings@example.com',
    phone: '082 000 0000',
  },
  reference: 'BK-000123',
  service: 'Standard Clean',
  when: 'Tuesday 13 October 2026 at 09:00',
  endTime: '10:30',
  price: 'R650',
  deposit: 'R325',
  balance: 'R325',
  deadline: 'Monday 12 October 2026 at 14:00',
  bank: {
    accountName: 'Fresh Start',
    bank: 'Example Bank',
    accountNumber: '1234567890',
    branchCode: '250655',
    accountType: 'Cheque',
  },
  link: 'https://example.com/booking/TOKEN123',
};

describe('renderPaymentInstructions', () => {
  const email = renderPaymentInstructions(data);

  it('uses the approved subject', () => {
    expect(email.subject).toBe(
      'Your booking request BK-000123: please pay your deposit',
    );
  });

  it('says the booking is confirmed only once payment arrives (C-5)', () => {
    const sentence =
      "Your booking is not confirmed yet. It's confirmed only once your deposit reflects in my bank account.";
    expect(email.text).toContain(sentence);
    expect(email.html).toContain(escapeHtml(sentence));
  });

  it('shows the reference as the EFT payment reference (BR-8)', () => {
    expect(email.text).toContain('Reference:       BK-000123');
    expect(email.text).toContain(
      'Please use BK-000123 as your payment reference',
    );
    expect(email.html).toContain(
      '<strong>BK-000123</strong> as your payment reference',
    );
  });

  it('shows every banking detail, the deposit, the deadline and the balance', () => {
    for (const body of [email.text, email.html]) {
      for (const value of [
        'Fresh Start',
        'Example Bank',
        '1234567890',
        '250655',
        'Cheque',
        'R325',
        'Monday 12 October 2026 at 14:00',
      ]) {
        expect(body).toContain(value);
      }
    }
    expect(email.text).toContain('The balance of R325 is payable on the day.');
  });

  it('holds the booking link in both versions, once as the button and once as text', () => {
    expect(email.text.match(/TOKEN123/g)).toHaveLength(1);
    expect(email.html.match(/TOKEN123/g)).toHaveLength(1);
  });

  it('gives the proof-by-email fallback', () => {
    expect(email.text).toContain(
      'Email your proof of payment to bookings@example.com with your reference BK-000123',
    );
  });

  it('does not let a client’s name inject markup into the HTML', () => {
    const html = renderPaymentInstructions({
      ...data,
      clientFirstName: '<img src=x onerror=alert(1)>',
    }).html;
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});
