// Find my booking (C-6, #52): POST /api/bookings/:reference/lookup with the
// email in the body, so it never appears in the address bar or a log.
import { el, formatRand } from '/js/format.js';
import { formatDay, localDate, localTime } from '/js/time-zone.js';

const $ = (selector) => document.querySelector(selector);
const form = $('#lookup-form');
const button = $('#find-button');

// One label, one icon and one shape per status, so they are told apart without
// colour (docs/style-guide.md, booking statuses)
const STATUSES = {
  pending: ['Pending', 'bi-hourglass-split'],
  confirmed: ['Confirmed', 'bi-check-circle'],
  completed: ['Completed', 'bi-stars'],
  no_show: ['No-show', 'bi-person-x'],
  cancelled: ['Cancelled', 'bi-x'],
  expired: ['Expired', 'bi-hourglass-bottom'],
};

// What the payment status means for the client
const PAYMENT = {
  awaiting_payment: 'Awaiting payment',
  proof_received: "Proof received: we're checking our account",
  proof_rejected: 'Proof rejected: please upload a new one',
  confirmed: 'Payment received',
  not_required: 'No deposit needed',
  expired: "Expired: the deposit wasn't paid in time",
  cancelled: 'Cancelled',
};

function showMessage(kind, text) {
  const icons = {
    danger: 'bi-x-circle',
    warning: 'bi-exclamation-triangle',
    info: 'bi-info-circle',
  };
  $('#lookup-message').className = `alert alert-${kind} d-flex gap-2`;
  $('#lookup-message-icon').className = `bi ${icons[kind]}`;
  $('#lookup-message-text').textContent = text;
}

function reset() {
  $('#lookup-message').className = 'alert d-none gap-2';
  $('#result').hidden = true;
  for (const input of form.querySelectorAll('.is-invalid'))
    input.classList.remove('is-invalid');
}

function fieldError(name, text) {
  $(`#${name}`).classList.add('is-invalid');
  $(`#${name}-error`).textContent = text;
}

const when = (iso, timeZone) => {
  const date = new Date(iso);
  return {
    day: formatDay(localDate(date, timeZone), {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }),
    time: localTime(date, timeZone),
  };
};

// What was asked for, kept so a new link can be requested without retyping
let current = null;

function render({ booking, canResendBookingLink }) {
  const { timeZone } = booking;
  const start = when(booking.startAt, timeZone);
  const end = when(booking.endAt, timeZone);

  $('#result-reference').textContent = booking.reference;
  $('#result-when').textContent =
    `${booking.service.name} · ${start.day}, ${start.time}–${end.time}`;

  const [label, icon] = STATUSES[booking.status];
  const badge = el('span', `mbg-status mbg-status-${booking.status}`);
  const iconEl = el('i', `bi ${icon}`);
  iconEl.setAttribute('aria-hidden', 'true');
  badge.append(iconEl, document.createTextNode(label));
  $('#result-status').replaceChildren(badge);

  const rows = [['Payment', PAYMENT[booking.paymentStatus]]];
  if (booking.paymentStatus !== 'not_required') {
    let deposit = formatRand(booking.depositAmount);
    if (booking.depositDueAt && booking.status === 'pending') {
      const due = when(booking.depositDueAt, timeZone);
      deposit += `, due by ${due.day}, ${due.time}`;
    }
    rows.push(['Deposit', deposit]);
  }
  if (booking.location === 'client') {
    rows.push(
      ['Where', `At your place: ${booking.appointmentAddress}`],
      ['Travel fee', formatRand(booking.travelFee)],
    );
  }
  rows.push(['Price', formatRand(booking.price)]);
  const cells = [];
  for (const [name, value] of rows) {
    const dd = el('dd', 'col-7', value);
    if (name === 'Payment') dd.classList.add('fw-bold');
    cells.push(el('dt', 'col-5 fw-normal text-secondary', name), dd);
  }
  $('#result-details').replaceChildren(...cells);

  // Proofs of payment, with the reason when one was rejected (BR-14)
  $('#proofs-section').hidden = booking.proofs.length === 0;
  $('#proofs').replaceChildren(
    ...booking.proofs.map((proof) => {
      const uploaded = when(proof.uploadedAt, timeZone);
      const names = {
        received: 'Received',
        accepted: 'Accepted',
        rejected: 'Rejected',
      };
      const icons = {
        received: 'bi-hourglass-split',
        accepted: 'bi-check-circle',
        rejected: 'bi-x-circle',
      };
      const li = el('li', 'mb-1');
      const mark = el('i', `bi ${icons[proof.status]} me-2`);
      mark.setAttribute('aria-hidden', 'true');
      li.append(
        mark,
        document.createTextNode(
          `Uploaded ${uploaded.day}, ${uploaded.time} · ${names[proof.status]}`,
        ),
      );
      if (proof.rejectionReason)
        li.append(document.createTextNode(`: "${proof.rejectionReason}"`));
      return li;
    }),
  );
  $('#resend-section').hidden = !canResendBookingLink;
  $('#resend-message').textContent = '';
  $('#result').hidden = false;
}

$('#resend-button').addEventListener('click', async (event) => {
  if (!current) return;
  const button = event.currentTarget;
  const message = $('#resend-message');
  button.disabled = true;
  message.textContent = '';
  try {
    const res = await fetch(
      `/api/bookings/${encodeURIComponent(current.reference)}/resend-booking-link`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: current.email }),
      },
    );
    message.textContent =
      res.status === 202
        ? 'If that booking is still active, a new link is on its way to your email.'
        : res.status === 429
          ? 'Too many requests. Please try again in a little while.'
          : 'Something went wrong. Please try again.';
  } catch {
    message.textContent =
      "Can't reach the server. Check your connection and try again.";
  } finally {
    button.disabled = false;
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  reset();
  const reference = $('#reference').value.trim().toUpperCase();
  const email = $('#email').value.trim();
  let valid = true;
  if (!reference) {
    fieldError('reference', 'Enter your booking reference.');
    valid = false;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fieldError('email', 'Enter the email you used to book.');
    valid = false;
  }
  if (!valid) {
    form.querySelector('.is-invalid')?.focus();
    return;
  }

  button.disabled = true;
  $('#lookup-loading').hidden = false;
  try {
    const res = await fetch(
      `/api/bookings/${encodeURIComponent(reference)}/lookup`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      },
    );
    if (res.ok) {
      current = { reference, email };
      render(await res.json());
    } else if (res.status === 404) {
      // One message for a wrong reference or a wrong email, so this page
      // can't be used to find out which bookings exist
      showMessage(
        'info',
        "We couldn't find a booking with that reference and email. Check both and try again.",
      );
    } else if (res.status === 429) {
      showMessage(
        'warning',
        'Too many attempts. Please try again in a few minutes.',
      );
    } else if (res.status === 400) {
      fieldError('email', 'Enter the email you used to book.');
    } else {
      showMessage('danger', 'Something went wrong. Please try again.');
    }
  } catch {
    showMessage(
      'danger',
      "Can't reach the server. Check your connection and try again.",
    );
  } finally {
    button.disabled = false;
    $('#lookup-loading').hidden = true;
  }
});
