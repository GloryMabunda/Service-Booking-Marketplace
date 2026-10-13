// Step 2 of booking (C-3, C-4, #51): the client's details.
//
//   /book-details.html?service=<id>&start=<UTC time from the picker>
//
// The page checks the details before sending them, with the same rules as the
// server; the server checks everything again. On success it keeps the answer
// for the confirmation page, which is the only place the reference is shown.
import { el, formatDuration, formatRand } from '/js/format.js';
import { normalizeSouthAfricanPhone } from '/js/phone.js';
import { formatDay, localDate, localTime } from '/js/time-zone.js';

const $ = (selector) => document.querySelector(selector);
const form = $('#booking-form');
const submitButton = $('#submit-button');
const FIELDS = ['clientName', 'clientEmail', 'clientPhone', 'notes'];

let service = null;
let business = null;
let timeZone = 'Africa/Johannesburg';
let startAt = null; // Date
let endAt = null;
let depositPercent = 0;

function showPageError(text) {
  $('#page-loading').hidden = true;
  $('#page-error-text').textContent = text;
  $('#page-error').classList.remove('d-none');
  $('#page-error').classList.add('d-flex');
}

// "Tue, 3 Nov 2026" and "09:00–10:30", in the business time zone
function whenText() {
  const day = formatDay(localDate(startAt, timeZone), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return {
    day,
    time: `${localTime(startAt, timeZone)}–${localTime(endAt, timeZone)}`,
    start: localTime(startAt, timeZone),
  };
}

async function load() {
  const params = new URLSearchParams(location.search);
  const start = new Date(params.get('start') ?? '');
  try {
    const res = await fetch('/api/services');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    service = data.services.find((s) => s.id === params.get('service'));
    business = data.business;
    timeZone = data.bookingWindow.timeZone;
    depositPercent = Number(data.depositPercent);
  } catch {
    showPageError("We couldn't load this page. Please refresh and try again.");
    return;
  }
  if (!service || Number.isNaN(start.getTime())) {
    showPageError("That booking isn't available. Please start again.");
    return;
  }

  startAt = start;
  endAt = new Date(start.getTime() + service.durationMinutes * 60_000);
  $('#back-link').href = `/book.html?service=${encodeURIComponent(service.id)}`;
  renderSummary();
  $('#page-loading').hidden = true;
  $('#content').hidden = false;
  $('#clientName').focus();
}

function renderSummary() {
  const when = whenText();
  const rows = [
    ['Service', service.name],
    ['When', `${when.day}, ${when.time}`],
    ['Duration', formatDuration(service.durationMinutes)],
    ['Price', formatRand(service.price)],
  ];
  if (depositPercent > 0)
    rows.push(['Deposit', formatRand(service.depositAmount)]);

  const cells = [];
  for (const [label, value] of rows) {
    const dt = el('dt', 'col-5 fw-normal text-secondary', label);
    const dd = el('dd', 'col-7', value);
    if (label === 'Deposit') dd.classList.add('fw-bold');
    cells.push(dt, dd);
  }
  $('#summary').replaceChildren(...cells);
  $('#summary-note').textContent =
    depositPercent > 0
      ? "Your booking is confirmed once the deposit reaches our account. You'll have until the deadline in your email to pay."
      : 'No deposit is needed: your booking is confirmed straight away.';
}

// --- Checking the details ---------------------------------------------------

function fieldError(name, text) {
  $(`#${name}`).classList.add('is-invalid');
  $(`#${name}-error`).textContent = text;
}

function clearErrors() {
  for (const input of form.querySelectorAll('.is-invalid')) {
    input.classList.remove('is-invalid');
  }
  hideAlert();
}

// The same rules as POST /api/bookings (docs/api.md 4.3)
function readForm() {
  clearErrors();
  const clientName = $('#clientName').value.trim();
  const clientEmail = $('#clientEmail').value.trim();
  const clientPhone = $('#clientPhone').value.trim();
  const notes = $('#notes').value.trim();
  let valid = true;
  const check = (ok, name, text) => {
    if (!ok) {
      fieldError(name, text);
      valid = false;
    }
  };

  check(clientName.length > 0, 'clientName', 'Enter your name.');
  check(
    clientName.length <= 100,
    'clientName',
    'The name must be at most 100 characters.',
  );
  // A simple shape check; the server decides what is a valid address
  check(
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail) && clientEmail.length <= 254,
    'clientEmail',
    'Enter a valid email address.',
  );
  check(
    normalizeSouthAfricanPhone(clientPhone) !== null,
    'clientPhone',
    'Enter a South African phone number.',
  );
  check(
    notes.length <= 1000,
    'notes',
    'The notes must be at most 1,000 characters.',
  );

  if (!valid) {
    // Focus the first problem so keyboard and screen reader users land on it
    form.querySelector('.is-invalid')?.focus();
    return null;
  }
  return {
    serviceId: service.id,
    startAt: startAt.toISOString().replace(/\.000Z$/, 'Z'),
    clientName,
    clientEmail,
    clientPhone,
    ...(notes ? { notes } : {}),
  };
}

$('#notes').addEventListener('input', () => {
  $('#notes-count').textContent =
    `${$('#notes').value.length.toLocaleString('en-ZA')} / 1,000`;
});

// --- Messages from the server -----------------------------------------------

function showAlert(kind, title, text, actions = []) {
  const box = $('#form-alert');
  box.className = `alert alert-${kind} d-flex gap-2`;
  const icons = {
    danger: 'bi-x-circle',
    warning: 'bi-exclamation-triangle',
    info: 'bi-info-circle',
  };
  $('#form-alert-icon').className = `bi ${icons[kind]}`;
  $('#form-alert-title').textContent = title;
  $('#form-alert-text').textContent = text;
  $('#form-alert-actions').replaceChildren(...actions);
  box.focus?.();
  box.scrollIntoView({ block: 'nearest' });
}

function hideAlert() {
  $('#form-alert').className = 'alert d-none gap-2';
}

function link(text, href, className = 'btn btn-sm btn-outline-primary') {
  const a = el('a', className, text);
  a.href = href;
  return a;
}

function showFailure(status, body) {
  const code = body?.code;
  const choose = link(
    'Choose another time',
    `/book.html?service=${encodeURIComponent(service.id)}`,
  );
  if (code === 'SLOT_UNAVAILABLE') {
    const when = whenText();
    showAlert(
      'warning',
      `Sorry, ${when.start} on ${when.day} is no longer available.`,
      'Your details are kept. Please choose another time.',
      [choose],
    );
  } else if (code === 'PENDING_LIMIT_REACHED') {
    showAlert(
      'warning',
      'You already have 2 bookings waiting for a deposit.',
      'Please pay for or cancel one of them first, or contact us.',
      [link('Find my booking', '/lookup.html')],
    );
  } else if (code === 'SERVICE_UNAVAILABLE') {
    showAlert(
      'danger',
      "That service isn't available any more.",
      'Please choose another.',
      [link('Choose a service', '/services.html')],
    );
  } else if (code === 'BOOKING_NOT_READY') {
    showAlert(
      'info',
      "Online booking isn't ready yet.",
      `Please contact us to book: ${business.email}`,
    );
  } else if (status === 429) {
    showAlert(
      'warning',
      'Too many attempts.',
      'Please try again in a few minutes.',
    );
  } else if (code === 'VALIDATION_FAILED') {
    const unplaced = [];
    for (const { field, message } of body.details ?? []) {
      if (FIELDS.includes(field)) fieldError(field, message);
      else unplaced.push(message);
    }
    if (unplaced.length)
      showAlert('danger', 'Please check your booking.', unplaced.join(' '), [
        choose,
      ]);
    form.querySelector('.is-invalid')?.focus();
  } else {
    showAlert(
      'danger',
      'Something went wrong.',
      "Your booking wasn't made. Please try again.",
    );
  }
}

// --- Sending ------------------------------------------------------------------

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (submitButton.disabled) return; // never twice
  const payload = readForm();
  if (!payload) return;

  submitButton.disabled = true;
  submitButton.replaceChildren(
    el('span', 'spinner-border spinner-border-sm me-2'),
    document.createTextNode('Booking…'),
  );
  submitButton.firstChild.setAttribute('aria-hidden', 'true');

  try {
    const res = await fetch('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => null);

    if (res.status === 201) {
      // The confirmation page shows this once. The booking link is never in it
      // (BR-15): it is only emailed.
      sessionStorage.setItem(
        'mbg-booking',
        JSON.stringify({ created: body, businessEmail: business.email }),
      );
      location.assign('/booking-confirmation.html');
      return;
    }
    showFailure(res.status, body);
  } catch {
    showAlert(
      'danger',
      "Can't reach the server.",
      'Check your connection and try again. Your details are kept.',
    );
  }
  submitButton.disabled = false;
  submitButton.textContent = 'Book and get payment instructions';
});

load();
