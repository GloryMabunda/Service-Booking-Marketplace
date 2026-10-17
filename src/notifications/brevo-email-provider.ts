import type { EmailMessage, EmailProvider } from './email-provider.js';

// Sends email through Brevo's web API (https://developers.brevo.com) instead of
// SMTP. It is a plain HTTPS request, so it also works on hosts that block the
// SMTP ports, such as Render's free plan (docs/demo.md). The free Brevo plan
// allows about 300 emails a day. The sender (MAIL_FROM) must be one verified in
// Brevo.
const ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

// "Your Business <bookings@example.com>" or just "bookings@example.com"
export function parseSender(from: string): { name?: string; email: string } {
  const match = /^\s*(.*?)\s*<([^<>\s]+)>\s*$/.exec(from);
  if (!match) return { email: from.trim() };
  const name = match[1]?.replace(/^"|"$/g, '').trim();
  return name ? { name, email: match[2] } : { email: match[2] };
}

export class BrevoEmailProvider implements EmailProvider {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const response = await this.fetchFn(ENDPOINT, {
      method: 'POST',
      headers: {
        'api-key': this.apiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: parseSender(this.from),
        to: [{ email: message.to }],
        subject: message.subject,
        textContent: message.text,
        htmlContent: message.html,
        ...(message.replyTo ? { replyTo: { email: message.replyTo } } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) return;
    let reason = '';
    try {
      reason = ((await response.json()) as { message?: string }).message ?? '';
    } catch {
      // The body wasn't JSON; the status is enough
    }
    throw new Error(
      `Brevo did not accept the email (${response.status})${reason ? `: ${reason}` : ''}`,
    );
  }
}
