import { toCents } from '../common/money.js';

// "R325", "R1,200", "R325.50": no cents unless there are cents
// (docs/emails.md section 1)
export function formatRand(amount: string): string {
  const cents = toCents(amount);
  const rand = Math.floor(cents / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const rest = cents % 100;
  return `R${rand}${rest ? `.${String(rest).padStart(2, '0')}` : ''}`;
}

function parts(date: Date, timeZone: string) {
  const found = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return found as Record<
    'weekday' | 'day' | 'month' | 'year' | 'hour' | 'minute',
    string
  >;
}

// "Tuesday 13 October 2026 at 09:00", in the business time zone
export function formatWhen(date: Date, timeZone: string): string {
  const p = parts(date, timeZone);
  return `${p.weekday} ${p.day} ${p.month} ${p.year} at ${p.hour}:${p.minute}`;
}

// "10:30"
export function formatTime(date: Date, timeZone: string): string {
  const p = parts(date, timeZone);
  return `${p.hour}:${p.minute}`;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
