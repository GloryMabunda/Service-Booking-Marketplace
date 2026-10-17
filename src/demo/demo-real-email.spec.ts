import type {
  EmailMessage,
  EmailProvider,
} from '../notifications/email-provider.js';
import { DemoMailbox } from './demo-mailbox.js';
import { DemoRealEmailProvider, isReservedAddress } from './demo-real-email.js';

const mail = (to: string): EmailMessage => ({
  to,
  subject: 'Your booking',
  text: 'Pay the deposit.',
  html: '<html><body><p>Pay the deposit.</p></body></html>',
});

function setup(limits = { dailyCap: 100, perAddressPerHour: 3 }) {
  const mailbox = new DemoMailbox();
  const sent: EmailMessage[] = [];
  const real: EmailProvider = {
    send: (message) => {
      sent.push(message);
      return Promise.resolve();
    },
  };
  let now = Date.parse('2026-10-17T10:00:00Z');
  const provider = new DemoRealEmailProvider(mailbox, real, limits, () => now);
  return {
    mailbox,
    sent,
    provider,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('isReservedAddress', () => {
  it.each([
    'demo@example.com',
    'a@EXAMPLE.org',
    'a@mail.test',
    'a@localhost',
    'a@x.invalid',
  ])('%s can never be a real inbox', (address) => {
    expect(isReservedAddress(address)).toBe(true);
  });

  it.each(['recruiter@gmail.com', 'a@company.co.za'])(
    '%s may be real',
    (address) => {
      expect(isReservedAddress(address)).toBe(false);
    },
  );
});

describe('DemoRealEmailProvider', () => {
  it('sends a real email, marked as a demo, and keeps a copy', async () => {
    const { provider, mailbox, sent } = setup();
    await provider.send(mail('recruiter@gmail.com'));

    expect(mailbox.list()).toHaveLength(1);
    expect(mailbox.list()[0]?.subject).toBe('Your booking');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.subject).toBe('[Demo] Your booking');
    expect(sent[0]?.text).toContain('demo of a booking system');
    expect(sent[0]?.html).toContain('demo of a booking system');
    expect(sent[0]?.html.endsWith('</body></html>')).toBe(true);
  });

  it('keeps made-up addresses on the mailbox only', async () => {
    const { provider, mailbox, sent } = setup();
    await provider.send(mail('demo@example.com'));
    await provider.send(mail('test@example.org'));
    expect(mailbox.list()).toHaveLength(2);
    expect(sent).toHaveLength(0);
  });

  it('limits each address to a few emails an hour', async () => {
    const { provider, sent, mailbox, advance } = setup();
    for (let i = 0; i < 5; i += 1) {
      await provider.send(mail('Recruiter@gmail.com'));
    }
    expect(sent).toHaveLength(3);
    expect(mailbox.list()).toHaveLength(5);

    advance(61 * 60_000);
    await provider.send(mail('recruiter@gmail.com'));
    expect(sent).toHaveLength(4);
  });

  it('stops at the daily cap, and starts again the next day', async () => {
    const { provider, sent, advance } = setup({
      dailyCap: 2,
      perAddressPerHour: 20,
    });
    await provider.send(mail('a@gmail.com'));
    await provider.send(mail('b@gmail.com'));
    await provider.send(mail('c@gmail.com'));
    expect(sent).toHaveLength(2);

    advance(24 * 3_600_000);
    await provider.send(mail('c@gmail.com'));
    expect(sent).toHaveLength(3);
  });

  it('reports a failed real send, after keeping the copy', async () => {
    const mailbox = new DemoMailbox();
    const provider = new DemoRealEmailProvider(
      mailbox,
      { send: () => Promise.reject(new Error('Brevo is down')) },
      { dailyCap: 10, perAddressPerHour: 3 },
    );
    await expect(provider.send(mail('a@gmail.com'))).rejects.toThrow(
      'Brevo is down',
    );
    expect(mailbox.list()).toHaveLength(1);
  });
});
