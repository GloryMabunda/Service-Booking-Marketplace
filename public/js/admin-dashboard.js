// The admin dashboard (A-2, #62): the figures and the next appointments from
// /api/admin/dashboard. Each figure links to the bookings it counts.
import { adminApi } from '/js/admin.js';
import { el } from '/js/format.js';
import { localDate } from '/js/time-zone.js';
import {
  loadTimeZone,
  showMessage,
  statusBadge,
  whenText,
} from '/js/admin-bookings-shared.js';

const $ = (selector) => document.querySelector(selector);

// [key, label, icon, where it leads]; `today` is the business-zone date
const FIGURES = (today) => [
  [
    'today',
    "Today's bookings",
    'bi-calendar-day',
    `/admin/bookings.html?status=pending,confirmed&from=${today}&to=${today}`,
  ],
  [
    'upcoming',
    'Upcoming',
    'bi-calendar-event',
    '/admin/bookings.html?status=pending,confirmed',
  ],
  [
    'completedThisMonth',
    'Completed this month',
    'bi-stars',
    '/admin/bookings.html?status=completed',
  ],
  [
    'awaitingDeposit',
    'Awaiting deposit',
    'bi-hourglass-split',
    '/admin/bookings.html?status=pending',
  ],
  [
    'proofsAwaitingReview',
    'Proofs awaiting review',
    'bi-file-earmark-check',
    '/admin/bookings.html?proof=received',
  ],
  [
    'refundsDue',
    'Refunds due',
    'bi-arrow-return-left',
    '/admin/bookings.html?refund=due',
  ],
];

function figure([, label, icon, href], value) {
  const col = el('div', 'col-6 col-md-4 col-lg-2');
  const card = el('a', 'card h-100 text-decoration-none mbg-card-raised');
  card.href = href;
  const body = el('div', 'card-body');
  const mark = el('i', `bi ${icon} text-secondary`);
  mark.setAttribute('aria-hidden', 'true');
  body.append(
    mark,
    el('div', 'display-6 fw-bold mt-1', String(value)),
    el('div', 'small text-secondary', label),
  );
  card.append(body);
  col.append(card);
  return col;
}

async function load() {
  const [{ ok, data }, timeZone] = await Promise.all([
    adminApi('GET', '/api/admin/dashboard'),
    loadTimeZone(),
  ]);
  $('#loading').hidden = true;
  if (!ok) {
    showMessage(
      $('#page-message'),
      'danger',
      "The dashboard couldn't be loaded. Please refresh the page.",
    );
    return;
  }

  const today = localDate(new Date(), timeZone);
  $('#figures').replaceChildren(
    ...FIGURES(today).map((f) => figure(f, data[f[0]])),
  );

  const rows = data.upcomingAppointments.map((appointment) => {
    const tr = el('tr');
    const when = el('td');
    const link = el('a', '', whenText(appointment.startAt, timeZone));
    link.href = `/admin/booking.html?id=${encodeURIComponent(appointment.id)}`;
    when.append(link);
    const status = el('td');
    status.append(statusBadge(appointment.status));
    tr.append(
      when,
      el('td', '', appointment.clientName),
      el('td', '', appointment.serviceName),
      status,
      el('td', 'font-monospace', appointment.reference),
    );
    return tr;
  });
  $('#upcoming-body').replaceChildren(...rows);
  $('#upcoming-wrap').hidden = rows.length === 0;
  $('#no-upcoming').hidden = rows.length > 0;
  $('#content').hidden = false;
}

load();
