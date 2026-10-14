import type { Settings } from '../settings/settings.schema.js';

// Text for the home page (C-9) that is worked out, not typed in.

// The About text as paragraphs: blank lines separate them. Plain text only:
// the page inserts it as text, never as HTML.
export function aboutParagraphs(text: string): string[] {
  return text
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}

// "50.00" → "50", "33.50" → "33.5"
function percent(value: string): string {
  return String(Number(value));
}

const WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
];
const word = (n: number) => WORDS[n] ?? String(n);

type PolicySettings = Pick<
  Settings,
  | 'depositPercent'
  | 'depositHoldHours'
  | 'minNoticeHours'
  | 'maxAdvanceDays'
  | 'depositRefundable'
  | 'refundCutoffHours'
>;

// The booking policies, written from the settings so they always match the
// real rules (docs/api.md 4.6). Deposit sentences are left out when no
// deposit is needed.
export function policyText(settings: PolicySettings): string[] {
  const lines: string[] = [];
  const hasDeposit = Number(settings.depositPercent) > 0;

  if (hasDeposit) {
    // The deadline is the time to pay, or sooner when the appointment is close:
    // that is the case for an appointment within notice + time to pay
    const days = Math.max(
      1,
      Math.ceil((settings.depositHoldHours + settings.minNoticeHours) / 24),
    );
    lines.push(
      `A ${percent(settings.depositPercent)}% deposit secures your booking. You'll get banking details by email.`,
      `Pay within ${settings.depositHoldHours} hours of booking (sooner for appointments in the next ${days === 1 ? 'day' : `${word(days)} days`}), or the booking expires and the time is released.`,
      'Your booking is confirmed once the deposit reflects in our account.',
    );
  }

  lines.push(
    settings.minNoticeHours > 0
      ? `Book at least ${settings.minNoticeHours} hours ahead, and up to ${settings.maxAdvanceDays} days ahead.`
      : `Book up to ${settings.maxAdvanceDays} days ahead.`,
  );

  if (hasDeposit) {
    lines.push(
      settings.depositRefundable
        ? `Cancel at least ${settings.refundCutoffHours} hours before your appointment for a full deposit refund.`
        : "Deposits aren't refundable.",
    );
  }
  return lines;
}

// "+27821234567" → "https://wa.me/27821234567"
export function whatsappUrl(number: string): string {
  return `https://wa.me/${number.replace(/^\+/, '')}`;
}

// The domains each social link must be on (docs/api.md 7.16)
export const SOCIAL_DOMAINS = {
  instagram: ['instagram.com'],
  facebook: ['facebook.com', 'fb.com'],
  tiktok: ['tiktok.com'],
} as const;

// An https link on the network's own domain (or a subdomain such as www)
export function isSocialUrl(
  network: keyof typeof SOCIAL_DOMAINS,
  value: string,
): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return SOCIAL_DOMAINS[network].some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
}
