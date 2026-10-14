// One booking in the admin portal (A-3, A-4, #63 to #66): everything about it,
// and what the owner can do next, through /api/admin/bookings/:id.
import { adminApi } from '/js/admin.js';
import { el, formatRand } from '/js/format.js';
import { localDate, localTime, zonedTimeToUtc } from '/js/time-zone.js';
import {
  apiProblem,
  loadTimeZone,
  PAYMENT,
  showMessage,
  statusBadge,
  whenText,
} from '/js/admin-bookings-shared.js';

const $ = (selector) => document.querySelector(selector);
const id = new URLSearchParams(location.search).get('id') ?? '';
const base = `/api/admin/bookings/${encodeURIComponent(id)}`;
const confirmModal = new bootstrap.Modal('#confirm-modal');

let timeZone = 'Africa/Johannesburg';
let booking = null;
let onConfirm = null; // what "Yes, continue" does

const EMAIL_NAMES = {
  payment_instructions: 'Payment instructions',
  booking_confirmed: 'Booking confirmed',
  proof_rejected: 'Proof not accepted',
  booking_cancelled: 'Booking cancelled',
  booking_expired: 'Booking expired',
  admin_new_booking: 'New booking (to you)',
  admin_proof_uploaded: 'Proof uploaded (to you)',
  admin_client_cancelled: 'Client cancelled (to you)',
};

// --- Showing the booking -----------------------------------------------------

function rows(list, target) {
  const cells = [];
  for (const [label, value] of list) {
    if (value === null || value === undefined) continue;
    const dd = el('dd', 'col-sm-8');
    if (value instanceof Node) dd.append(value);
    else dd.textContent = value;
    cells.push(el('dt', 'col-sm-4 fw-normal text-secondary', label), dd);
  }
  target.replaceChildren(...cells);
}

function mailLink(email) {
  const a = el('a', '', email);
  a.href = `mailto:${email}`;
  return a;
}

function phoneLink(phone) {
  const a = el('a', '', phone);
  a.href = `tel:${phone}`;
  return a;
}

function render({ booking: b, proofs, notifications }) {
  booking = b;
  document.title = `${b.reference} · Make Up by Glory admin`;
  $('#reference').textContent = b.reference;
  $('#status').replaceChildren(statusBadge(b.status));

  rows(
    [
      ['Service', b.service.name],
      [
        'When',
        `${whenText(b.startAt, timeZone)}–${localTime(new Date(b.endAt), timeZone)}`,
      ],
      ['Held until', localTime(new Date(b.occupiedUntil), timeZone)],
      ['Notes', b.notes],
    ],
    $('#appointment'),
  );
  rows(
    [
      ['Name', b.client.name],
      ['Email', mailLink(b.client.email)],
      ['Phone', phoneLink(b.client.phone)],
    ],
    $('#client'),
  );

  const refund = b.refundDue
    ? b.refundedAt
      ? `Refund paid on ${whenText(b.refundedAt, timeZone)}`
      : 'Refund due: not paid yet'
    : null;
  rows(
    [
      ['Status', PAYMENT[b.paymentStatus]],
      ['Price', formatRand(b.price)],
      ['Deposit', formatRand(b.depositAmount)],
      [
        'Deposit due by',
        b.depositDueAt && b.status === 'pending'
          ? whenText(b.depositDueAt, timeZone)
          : null,
      ],
      [
        'Amount received',
        b.amountReceived ? formatRand(b.amountReceived) : null,
      ],
      [
        'Confirmed on',
        b.paymentVerifiedAt ? whenText(b.paymentVerifiedAt, timeZone) : null,
      ],
      [
        'Cancelled',
        b.cancelledAt
          ? `${whenText(b.cancelledAt, timeZone)}, by ${b.cancelledBy === 'client' ? 'the client' : 'you'}`
          : null,
      ],
      ['Refund', refund],
    ],
    $('#payment'),
  );

  renderProofs(proofs);
  renderEmails(notifications);
  renderActions();
}

function renderProofs(proofs) {
  $('#no-proofs').hidden = proofs.length > 0;
  $('#proofs').replaceChildren(
    ...proofs.map((proof) => {
      const li = el('li', 'mb-2');
      li.append(
        el(
          'div',
          '',
          `${proof.originalFilename}: ${proof.status}, uploaded ${whenText(proof.uploadedAt, timeZone)}`,
        ),
      );
      if (proof.rejectionReason) {
        li.append(
          el(
            'div',
            'small text-secondary',
            `Rejected: "${proof.rejectionReason}"`,
          ),
        );
      }
      if (proof.usedOnOtherBookings.length) {
        li.append(
          el(
            'div',
            'small text-danger',
            `This exact file was also uploaded for ${proof.usedOnOtherBookings.join(', ')}.`,
          ),
        );
      }
      return li;
    }),
  );
}

function renderEmails(notifications) {
  $('#no-emails').hidden = notifications.length > 0;
  $('#emails').replaceChildren(
    ...notifications.map((n) => {
      const li = el('li', 'mb-1');
      const mark = el(
        'i',
        `bi ${n.status === 'sent' ? 'bi-check-circle' : n.status === 'failed' ? 'bi-x-circle text-danger' : 'bi-hourglass-split'} me-2`,
      );
      mark.setAttribute('aria-hidden', 'true');
      li.append(
        mark,
        document.createTextNode(
          `${EMAIL_NAMES[n.type] ?? n.type} to ${n.recipient}: ${n.status}${n.error ? ` (${n.error})` : ''}`,
        ),
      );
      return li;
    }),
  );
}

// --- What can be done --------------------------------------------------------

function renderActions() {
  const pending = booking.status === 'pending';
  const confirmed = booking.status === 'confirmed';
  const started = new Date(booking.startAt) <= new Date();

  $('#confirm-form').hidden = !pending;
  $('#deadline-form').hidden = !pending;
  $('#status-actions').hidden = !(confirmed && started);
  $('#link-actions').hidden = !((pending || confirmed) && !started);
  $('#cancel-actions').hidden = !(pending || confirmed);
  $('#no-actions').hidden = pending || confirmed;

  if (pending) {
    $('#amount').value = booking.depositAmount;
    const due = new Date(booking.depositDueAt);
    $('#deadline').value =
      `${localDate(due, timeZone)}T${localTime(due, timeZone)}`;
  }
}

function clearErrors() {
  for (const input of document.querySelectorAll('.is-invalid')) {
    input.classList.remove('is-invalid');
  }
  $('#page-message').replaceChildren();
}

function fieldError(name, text) {
  $(`#${name}`).classList.add('is-invalid');
  $(`#${name}-error`).textContent = text;
}

// Sends an action, then shows what happened and reloads the booking
async function act(method, path, payload, done) {
  clearErrors();
  const buttons = document.querySelectorAll('main button');
  for (const button of buttons) button.disabled = true;
  const { ok, status, data } = await adminApi(
    method,
    `${base}${path}`,
    payload,
  );
  for (const button of buttons) button.disabled = false;

  if (!ok) {
    const text = apiProblem(
      data,
      status === 404
        ? 'This booking no longer exists.'
        : 'Something went wrong. Nothing was changed. Please try again.',
    );
    showMessage($('#page-message'), 'danger', text);
    if (status === 409) await load(); // it changed: show how it is now
    return false;
  }
  await load();
  const message = done(data);
  showMessage($('#page-message'), message.kind, message.text);
  return true;
}

const emailNote = (data, what) =>
  data.emailSentTo
    ? {
        kind: 'success',
        text: `${what} and an email was sent to ${data.emailSentTo}.`,
      }
    : {
        kind: 'warning',
        text: `${what}, but the email couldn't be sent. You can send the client a new booking link to try again.`,
      };

function ask({ title, text, yes, refund = false, run }) {
  $('#confirm-title').textContent = title;
  $('#confirm-text').textContent = text;
  $('#confirm-yes').textContent = yes;
  $('#refund-choice').hidden = !refund;
  $('#refund-error').textContent = '';
  for (const radio of document.querySelectorAll('input[name="refund"]')) {
    radio.checked = false;
  }
  onConfirm = run;
  confirmModal.show();
}

$('#confirm-yes').addEventListener('click', async () => {
  if (!onConfirm) return;
  const proceed = await onConfirm();
  if (proceed !== false) confirmModal.hide();
});

// Confirm payment (#64)
$('#confirm-form').addEventListener('submit', (event) => {
  event.preventDefault();
  clearErrors();
  const amount = $('#amount').value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) {
    fieldError('amount', 'Enter the amount you received, such as 325.00.');
    return;
  }
  const less = Number(amount) < Number(booking.depositAmount);
  ask({
    title: 'Confirm payment',
    text:
      `Confirm that you received ${formatRand(Number(amount).toFixed(2))} for ${booking.reference}? ` +
      `The client is emailed a confirmation with a new private booking link.` +
      (less
        ? ` This is less than the deposit of ${formatRand(booking.depositAmount)}.`
        : ''),
    yes: 'Yes, confirm payment',
    run: () =>
      act('POST', '/confirm-payment', { amountReceived: amount }, (data) =>
        emailNote(data, 'Payment confirmed'),
      ),
  });
});

// Extend the deadline (#65)
$('#deadline-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  clearErrors();
  const value = $('#deadline').value;
  if (!value) {
    fieldError('deadline', 'Choose a date and time.');
    return;
  }
  const [date, time] = value.split('T');
  const when = zonedTimeToUtc(date, time, timeZone);
  await act(
    'PATCH',
    '/deadline',
    { depositDueAt: when.toISOString().replace(/\.000Z$/, 'Z') },
    () => ({ kind: 'success', text: 'The deposit deadline was extended.' }),
  );
});

// A new booking link (#66)
$('#link-button').addEventListener('click', () => {
  ask({
    title: 'Send a new booking link',
    text: `Email ${booking.client.name} a new private link? The old link stops working.`,
    yes: 'Yes, send it',
    run: () =>
      act('POST', '/booking-link', undefined, (data) =>
        emailNote(data, 'A new booking link was made'),
      ),
  });
});

// Cancel (#65)
$('#cancel-button').addEventListener('click', () => {
  const confirmed = booking.status === 'confirmed';
  ask({
    title: 'Cancel this booking',
    text: `Cancel ${booking.reference}? The time becomes free again and ${booking.client.name} is emailed.`,
    yes: 'Yes, cancel the booking',
    refund: confirmed && Number(booking.depositAmount) > 0,
    run: () => {
      const payload = { status: 'cancelled' };
      if (confirmed && Number(booking.depositAmount) > 0) {
        const choice = document.querySelector('input[name="refund"]:checked');
        if (!choice) {
          $('#refund-error').textContent = 'Choose whether a refund is due.';
          return false;
        }
        payload.refundDue = choice.value === 'yes';
      } else if (confirmed) {
        payload.refundDue = false;
      }
      return act('PATCH', '/status', payload, (data) =>
        emailNote(data, 'The booking was cancelled'),
      );
    },
  });
});

// Completed and no-show (#65)
for (const [button, status, text] of [
  ['#complete-button', 'completed', 'The booking was marked completed.'],
  ['#no-show-button', 'no_show', 'The booking was marked as a no-show.'],
]) {
  $(button).addEventListener('click', () =>
    act('PATCH', '/status', { status }, () => ({ kind: 'success', text })),
  );
}

// --- Loading ---------------------------------------------------------------

async function load() {
  const { ok, status, data } = await adminApi('GET', base);
  $('#loading').hidden = true;
  if (!ok) {
    showMessage(
      $('#page-message'),
      'danger',
      status === 404
        ? "We couldn't find that booking."
        : "The booking couldn't be loaded. Please refresh the page.",
    );
    $('#content').hidden = true;
    return;
  }
  render(data);
  $('#content').hidden = false;
}

loadTimeZone().then((zone) => {
  timeZone = zone;
  load();
});
