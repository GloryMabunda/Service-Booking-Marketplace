import type {
  EmailMessage,
  EmailProvider,
} from '../notifications/email-provider.js';

// The hosted demo can send a real email to the address a visitor types, so a
// recruiter sees real delivery (docs/demo.md). It is tightly limited: every
// email is also kept on the demo mailbox, addresses that can't be real (the
// demo's own owner, example.com) never leave the demo, each address gets a few
// emails an hour, and the whole demo has a daily cap.

const RESERVED_DOMAINS = [
  'example.com',
  'example.net',
  'example.org',
  'localhost',
];
const RESERVED_ENDINGS = ['.test', '.example', '.invalid', '.localhost'];

export function isReservedAddress(address: string): boolean {
  const domain = address.trim().toLowerCase().split('@').pop() ?? '';
  return (
    RESERVED_DOMAINS.includes(domain) ||
    RESERVED_ENDINGS.some((ending) => domain.endsWith(ending))
  );
}

const NOTE_TEXT =
  '\n\n--\nThis email comes from a demo of a booking system. Nothing in it is real: no appointment was made and no payment is due.';
const NOTE_HTML =
  '<p style="margin-top:24px;padding-top:12px;border-top:1px solid #d6e3f3;font-size:12px;color:#4d6178">This email comes from a demo of a booking system. Nothing in it is real: no appointment was made and no payment is due.</p>';

export interface DemoRealEmailLimits {
  dailyCap: number;
  perAddressPerHour: number;
}

export class DemoRealEmailProvider implements EmailProvider {
  private perAddress = new Map<string, number[]>();
  private day = '';
  private sentToday = 0;

  constructor(
    private readonly mailbox: EmailProvider,
    private readonly real: EmailProvider,
    private readonly limits: DemoRealEmailLimits,
    private readonly now: () => number = Date.now,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    // The demo mailbox always has a copy, whatever happens next
    await this.mailbox.send(message);
    if (isReservedAddress(message.to) || !this.allow(message.to)) return;
    await this.real.send({
      ...message,
      subject: `[Demo] ${message.subject}`,
      text: message.text + NOTE_TEXT,
      html: message.html.includes('</body>')
        ? message.html.replace('</body>', `${NOTE_HTML}</body>`)
        : message.html + NOTE_HTML,
    });
  }

  // Counts the email when it is allowed
  private allow(address: string): boolean {
    const now = this.now();
    const day = new Date(now).toISOString().slice(0, 10);
    if (day !== this.day) {
      this.day = day;
      this.sentToday = 0;
    }
    if (this.sentToday >= this.limits.dailyCap) return false;
    const key = address.trim().toLowerCase();
    const recent = (this.perAddress.get(key) ?? []).filter(
      (time) => now - time < 3_600_000,
    );
    if (recent.length >= this.limits.perAddressPerHour) return false;
    recent.push(now);
    this.perAddress.set(key, recent);
    this.sentToday += 1;
    return true;
  }
}
