// Step 3 of booking (C-5, #51): the confirmation. It is built from the answer
// to POST /api/bookings, which the details page keeps for this tab only.
import { el, formatRand } from '/js/format.js';
import { formatDay, localDate, localTime } from '/js/time-zone.js';

const $ = (selector) => document.querySelector(selector);

function load() {
  let saved;
  try {
    saved = JSON.parse(sessionStorage.getItem('mbg-booking') ?? 'null');
  } catch {
    saved = null; // storage blocked or the value isn't JSON
  }
  if (!saved?.created?.booking) {
    $('#nothing').hidden = false;
    return;
  }
  render(saved.created, saved.businessEmail);
  $('#done').hidden = false;
}

function dayAndTime(iso, timeZone) {
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
}

function render({ booking, emailSentTo }, businessEmail) {
  const pending = booking.status === 'pending';
  const { timeZone } = booking;
  const start = dayAndTime(booking.startAt, timeZone);
  const end = dayAndTime(booking.endAt, timeZone);

  // The heading says whether the booking is yet confirmed (C-5)
  $('#done-icon').classList.add(
    pending ? 'bi-hourglass-split' : 'bi-check-circle',
  );
  $('#done-title').textContent = pending
    ? 'Booking received, not yet confirmed'
    : 'Booking confirmed';
  $('#reference').textContent = booking.reference;
  window.mbgSetTitle?.(pending ? 'Booking received' : 'Booking confirmed');

  const rows = [
    ['Service', booking.service.name],
    ['When', `${start.day}, ${start.time}–${end.time}`],
  ];
  if (booking.location === 'client') {
    rows.push(
      ['Where', `At your place: ${booking.appointmentAddress}`],
      ['Travel fee', formatRand(booking.travelFee)],
    );
  }
  if (pending) {
    rows.push(['Deposit', formatRand(booking.depositAmount)]);
    const due = dayAndTime(booking.depositDueAt, timeZone);
    rows.push(['Pay by', `${due.day}, ${due.time}`]);
  } else {
    rows.push(['Price', formatRand(booking.price)]);
  }
  const cells = [];
  for (const [label, value] of rows) {
    const dd = el('dd', 'col-7', value);
    if (label === 'Deposit' || label === 'Pay by') dd.classList.add('fw-bold');
    cells.push(el('dt', 'col-5 fw-normal text-secondary', label), dd);
  }
  $('#details').replaceChildren(...cells);

  // What happens next. The email line only claims what really happened.
  const steps = [];
  const emailStep = el('li');
  if (emailSentTo) {
    emailStep.append(
      document.createTextNode(
        pending
          ? "We've emailed payment instructions and your private booking link to "
          : "We've emailed your confirmation, with a link to cancel if your plans change, to ",
      ),
      el('strong', '', emailSentTo),
      document.createTextNode('.'),
    );
    steps.push(emailStep);
  } else {
    $('#email-warning').classList.remove('d-none');
    $('#email-warning').classList.add('d-flex');
    for (const part of document.querySelectorAll('.payment-only'))
      part.hidden = !pending;
  }

  if (pending) {
    // The reference is the EFT payment reference (BR-8)
    const pay = el('li');
    pay.append(
      document.createTextNode('Pay the deposit by EFT using '),
      el('strong', '', booking.reference),
      document.createTextNode(' as the payment reference.'),
    );
    steps.push(
      pay,
      el(
        'li',
        '',
        'Upload your proof of payment using the booking link in the email.',
      ),
      el(
        'li',
        '',
        "Your booking is confirmed once the payment reflects in our account. If it isn't paid by the deadline, the booking expires and the time is released.",
      ),
    );
  }
  $('#next-steps').replaceChildren(...steps);
  $('#next-steps').hidden = steps.length === 0;
  $('#next-steps').previousElementSibling.hidden = steps.length === 0; // the heading

  // The fallback for sending proof by email (C-5)
  $('#proof-fallback').hidden = !pending;
  for (const link of document.querySelectorAll('.email-link')) {
    link.textContent = businessEmail;
    link.href = `mailto:${businessEmail}?subject=${encodeURIComponent(`Booking ${booking.reference}`)}`;
  }
}

$('#copy-reference').addEventListener('click', async (event) => {
  const label = event.currentTarget.querySelector('span');
  try {
    await navigator.clipboard.writeText($('#reference').textContent);
    label.textContent = 'Copied';
  } catch {
    label.textContent = 'Select and copy it above';
  }
  setTimeout(() => (label.textContent = 'Copy reference'), 2500);
});

// Starting another booking forgets this one
$('#another').addEventListener('click', () =>
  sessionStorage.removeItem('mbg-booking'),
);

load();
