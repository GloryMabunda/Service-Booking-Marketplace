// The admin calendar (A-7, #76): the appointments and blocked times from
// /api/admin/calendar in FullCalendar. Clicking an appointment opens the
// booking.
import { adminApi } from '/js/admin.js';
import { el } from '/js/format.js';
import {
  STATUSES,
  loadTimeZone,
  showMessage,
} from '/js/admin-bookings-shared.js';
import { localDate, localTime } from '/js/time-zone.js';

const $ = (selector) => document.querySelector(selector);

// How each status looks. The colour is never the only difference: each also
// has its own mark in the title and its own border (docs/style-guide.md).
const LOOK = {
  pending: {
    bg: '#FFF3E0',
    border: '#8A6D00',
    text: '#6E3B00',
    mark: '⏳',
    style: 'dashed',
  },
  confirmed: {
    bg: '#1F7A4D',
    border: '#1F7A4D',
    text: '#FFFFFF',
    mark: '✔',
    style: 'solid',
  },
  completed: {
    bg: '#E6EEFB',
    border: '#9DB6E0',
    text: '#123A66',
    mark: '★',
    style: 'solid',
  },
  no_show: {
    bg: '#FCE4EC',
    border: '#C2185B',
    text: '#8A1038',
    mark: '✖',
    style: 'solid',
  },
  cancelled: {
    bg: '#FFFFFF',
    border: '#8294AD',
    text: '#4D6178',
    mark: '∅',
    style: 'dotted',
  },
  expired: {
    bg: '#FFFFFF',
    border: '#8294AD',
    text: '#4D6178',
    mark: '⌛',
    style: 'dotted',
  },
};

let timeZone = 'Africa/Johannesburg';
let calendar = null;

// FullCalendar only knows the browser's zone and UTC. To show the business's
// own clock whatever the computer's zone, every instant is turned into the
// business wall-clock time and given to a UTC calendar as if it were UTC.
function wall(iso) {
  const date = new Date(iso);
  return `${localDate(date, timeZone)}T${localTime(date, timeZone)}:00`;
}

// "2026-11-03" for a calendar date (the calendar runs in UTC)
const day = (date) => date.toISOString().slice(0, 10);

function blockedKey() {
  const item = el('li', 'list-inline-item me-3');
  const swatch = el('span', 'd-inline-block align-middle me-1');
  swatch.style.cssText =
    'width:1rem;height:1rem;border-radius:3px;background:#E3E9F2;border:2px solid #8294AD';
  item.append(swatch, document.createTextNode('⛔ Blocked time'));
  return item;
}

function legend() {
  $('#legend').replaceChildren(
    ...Object.entries(STATUSES).map(([status, [label]]) => {
      const look = LOOK[status];
      const item = el('li', 'list-inline-item me-3');
      const swatch = el('span', 'd-inline-block align-middle me-1');
      swatch.style.cssText = `width:1rem;height:1rem;border-radius:3px;background:${look.bg};border:2px ${look.style} ${look.border}`;
      item.append(swatch, document.createTextNode(`${look.mark} ${label}`));
      return item;
    }),
    blockedKey(),
  );
}

async function fetchEvents(info, success, failure) {
  const from = day(info.start);
  // info.end is the first day after the range
  const to = day(new Date(info.end.getTime() - 1));
  const include = $('#include-cancelled').checked;
  const { ok, data } = await adminApi(
    'GET',
    `/api/admin/calendar?from=${from}&to=${to}${include ? '&includeCancelled=true' : ''}`,
  );
  if (!ok) {
    showMessage(
      $('#page-message'),
      'danger',
      "The calendar couldn't be loaded. Please try again.",
    );
    failure(new Error('calendar request failed'));
    return;
  }
  $('#page-message').replaceChildren();

  const bookings = data.events.map((event) => {
    const look = LOOK[event.status];
    return {
      id: event.id,
      title: `${look.mark} ${event.title}`,
      start: wall(event.start),
      end: wall(event.end),
      backgroundColor: look.bg,
      borderColor: look.border,
      textColor: look.text,
      classNames: [`mbg-cal-${event.status}`],
      extendedProps: { reference: event.reference, status: event.status },
    };
  });
  // Time the owner has blocked off. A normal grey event rather than FullCalendar's
  // background shading, which the month view doesn't draw for timed events.
  const blocked = data.blockedTimes.map((time) => ({
    id: `blocked-${time.id}`,
    title: `⛔ ${time.reason ? `Blocked: ${time.reason}` : 'Blocked'}`,
    start: wall(time.start),
    end: wall(time.end),
    backgroundColor: '#E3E9F2',
    borderColor: '#8294AD',
    textColor: '#2B3B52',
    classNames: ['mbg-cal-blocked'],
  }));
  success([...bookings, ...blocked]);
}

function start() {
  legend();
  calendar = new FullCalendar.Calendar($('#calendar'), {
    timeZone: 'UTC', // see wall() above
    initialView: window.innerWidth < 768 ? 'listWeek' : 'dayGridMonth',
    firstDay: 1,
    height: 'auto',
    nowIndicator: true,
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: 'dayGridMonth,timeGridWeek,listWeek',
    },
    buttonText: { today: 'Today', month: 'Month', week: 'Week', list: 'List' },
    eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
    slotMinTime: '06:00:00',
    slotMaxTime: '22:00:00',
    events: fetchEvents,
    eventClick: (info) => {
      info.jsEvent.preventDefault();
      // Blocked time isn't a booking: nothing to open
      if (info.event.id.startsWith('blocked-')) return;
      location.assign(
        `/admin/booking.html?id=${encodeURIComponent(info.event.id)}`,
      );
    },
    eventDidMount: (info) => {
      const { reference, status } = info.event.extendedProps;
      if (!reference) return;
      // Cancelled and expired look struck through, like their status badge
      const look = LOOK[status];
      info.el.style.borderStyle = look.style;
      info.el.style.borderWidth = '2px';
      if (status === 'cancelled' || status === 'expired') {
        info.el.style.textDecoration = 'line-through';
      }
      info.el.title = `${reference} · ${STATUSES[status][0]}`;
      info.el.setAttribute(
        'aria-label',
        `${info.event.title}, ${STATUSES[status][0]}`,
      );
    },
  });
  calendar.render();
  $('#include-cancelled').addEventListener('change', () =>
    calendar.refetchEvents(),
  );
}

// FullCalendar loads deferred, before this module runs
loadTimeZone().then((zone) => {
  timeZone = zone;
  start();
});
