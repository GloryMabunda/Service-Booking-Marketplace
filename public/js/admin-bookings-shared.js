// Shared by the admin dashboard, bookings list and booking pages (#62, #63).
import { el } from '/js/format.js';
import { formatDay, localDate, localTime } from '/js/time-zone.js';

// One label, one icon and one shape per status, so they are told apart without
// colour (docs/style-guide.md, booking statuses)
export const STATUSES = {
  pending: ['Pending', 'bi-hourglass-split'],
  confirmed: ['Confirmed', 'bi-check-circle'],
  completed: ['Completed', 'bi-stars'],
  no_show: ['No-show', 'bi-person-x'],
  cancelled: ['Cancelled', 'bi-x'],
  expired: ['Expired', 'bi-hourglass-bottom'],
};

// What the payment status means for the owner
export const PAYMENT = {
  awaiting_payment: 'Awaiting payment',
  proof_received: 'Proof received: check your bank',
  proof_rejected: 'Proof rejected',
  confirmed: 'Payment confirmed',
  not_required: 'No deposit needed',
  expired: 'Expired unpaid',
  cancelled: 'Cancelled',
};

export function statusBadge(status) {
  const [label, icon] = STATUSES[status];
  const badge = el('span', `mbg-status mbg-status-${status}`);
  const mark = el('i', `bi ${icon}`);
  mark.setAttribute('aria-hidden', 'true');
  badge.append(mark, document.createTextNode(label));
  return badge;
}

// The business time zone, which the public services API reports
export async function loadTimeZone() {
  try {
    const res = await fetch('/api/services');
    const data = await res.json();
    return data.bookingWindow.timeZone;
  } catch {
    return 'Africa/Johannesburg';
  }
}

// "Tue, 3 Nov 2026, 09:00" in the business time zone
export function whenText(iso, timeZone) {
  const date = new Date(iso);
  const day = formatDay(localDate(date, timeZone), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return `${day}, ${localTime(date, timeZone)}`;
}

// Shows a message in a box with role="status" (or "alert" for errors)
export function showMessage(box, kind, text) {
  const icons = {
    success: 'bi-check-circle',
    danger: 'bi-x-circle',
    warning: 'bi-exclamation-triangle',
    info: 'bi-info-circle',
  };
  const alert = el('div', `alert alert-${kind} d-flex gap-2`);
  alert.setAttribute('role', kind === 'danger' ? 'alert' : 'status');
  const icon = el('i', `bi ${icons[kind]}`);
  icon.setAttribute('aria-hidden', 'true');
  alert.append(icon, el('span', '', text));
  box.replaceChildren(alert);
}

// The first problem the API reported for a request, as a sentence
export function apiProblem(data, fallback) {
  const detail = data?.details?.[0]?.message;
  return detail ?? data?.message ?? fallback;
}
