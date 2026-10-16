// The client's private booking page (C-7, C-8, #68 to #70, #73): opened from
// the link in their email, /booking/<token>.
//
// The page holds no data itself. It asks /api/booking/<token>, which answers
// the same way for every link that doesn't work. Opening it changes nothing;
// uploading and cancelling are separate actions the client takes. It loads no
// third-party scripts, and nothing here sends the token anywhere but this site.
import { el, formatRand } from '/js/format.js';
import { localTime } from '/js/time-zone.js';
import {
  showMessage,
  statusBadge,
  whenText,
} from '/js/admin-bookings-shared.js';

const $ = (selector) => document.querySelector(selector);
const token = location.pathname.split('/')[2] ?? '';
const api = (path = '') => `/api/booking/${encodeURIComponent(token)}${path}`;

// What the payment status means for the client
const PAYMENT = {
  awaiting_payment: 'Awaiting payment',
  proof_received: "Proof received: we're checking our account",
  proof_rejected: 'Proof not accepted: please upload a new one',
  confirmed: 'Payment received',
  not_required: 'No deposit needed',
  expired: "Expired: the deposit wasn't paid in time",
  cancelled: 'Cancelled',
};

let page = null;

// --- Showing the booking -----------------------------------------------------

function rows(list, target) {
  target.replaceChildren(
    ...list.flatMap(([label, value]) => [
      el('dt', 'col-sm-4 fw-normal text-secondary', label),
      el('dd', 'col-sm-8', value),
    ]),
  );
}

function render() {
  const { booking, bankingDetails, business, cancellation } = page;
  const tz = booking.timeZone;
  const pending = booking.status === 'pending';

  $('#reference').textContent = booking.reference;
  $('#status').replaceChildren(statusBadge(booking.status));
  window.mbgSetTitle?.(booking.reference);

  const summary = [
    ['Service', booking.service.name],
    [
      'When',
      `${whenText(booking.startAt, tz)}–${localTime(new Date(booking.endAt), tz)}`,
    ],
  ];
  // Where the appointment is (#115). Our address is given here, on the private
  // page, and in emails, and nowhere on the public site.
  if (booking.location === 'client') {
    summary.push(
      ['Where', `At your place: ${booking.appointmentAddress}`],
      ['Travel fee', formatRand(booking.travelFee)],
    );
  } else if (page.ownerAddress) {
    summary.push(['Where', `At our place: ${page.ownerAddress}`]);
  }
  summary.push(['Price', formatRand(booking.price)]);
  if (Number(booking.depositAmount) > 0) {
    summary.push(['Deposit', formatRand(booking.depositAmount)]);
    summary.push(['Payment', PAYMENT[booking.paymentStatus]]);
  }
  if (pending && booking.depositDueAt) {
    summary.push(['Pay by', whenText(booking.depositDueAt, tz)]);
  }
  rows(summary, $('#summary'));

  // How to pay
  $('#pay-section').hidden = !(pending && bankingDetails);
  if (pending && bankingDetails) {
    $('#pay-intro').textContent =
      `Pay ${formatRand(booking.depositAmount)} by EFT` +
      (booking.depositDueAt
        ? ` by ${whenText(booking.depositDueAt, tz)}`
        : '') +
      ' to:';
    rows(
      [
        ['Account name', bankingDetails.accountName],
        ['Bank', bankingDetails.bank],
        ['Account number', bankingDetails.accountNumber],
        ['Branch code', bankingDetails.branchCode],
        ['Account type', bankingDetails.accountType],
        ['Reference', booking.reference],
      ],
      $('#bank'),
    );
    $('#pay-reference').textContent = booking.reference;
  }

  // Proofs
  $('#upload-section').hidden = !pending;
  if (pending) {
    $('#proofs').replaceChildren(
      ...booking.proofs.map((proof) => {
        const names = {
          received: 'Received: we will check our account',
          accepted: 'Accepted',
          rejected: 'Not accepted',
        };
        const li = el('li', 'mb-2');
        const mark = el(
          'i',
          `bi ${proof.status === 'rejected' ? 'bi-x-circle text-danger' : proof.status === 'accepted' ? 'bi-check-circle' : 'bi-hourglass-split'} me-2`,
        );
        mark.setAttribute('aria-hidden', 'true');
        li.append(
          mark,
          document.createTextNode(
            `Uploaded ${whenText(proof.uploadedAt, tz)}: ${names[proof.status]}`,
          ),
        );
        if (proof.rejectionReason) {
          li.append(
            el(
              'div',
              'small text-danger ms-4',
              `Reason: "${proof.rejectionReason}"`,
            ),
          );
        }
        return li;
      }),
    );
    $('#upload-form').hidden = !page.canUploadProof;
    $('#email-fallback').textContent = '';
    if (!page.canUploadProof) {
      showMessage(
        $('#message'),
        'info',
        "You've uploaded the most proofs of payment allowed for this booking. If something is wrong, please contact us.",
      );
    }
    const email = el('a', '', business.email);
    email.href = `mailto:${business.email}?subject=${encodeURIComponent(`Booking ${booking.reference}`)}`;
    $('#email-fallback').replaceChildren(
      document.createTextNode(
        "Can't upload it here? Email your proof of payment to ",
      ),
      email,
      document.createTextNode(` with your reference ${booking.reference}.`),
    );
  }

  // Cancel
  $('#cancel-explanation').textContent = cancellation.explanation;
  $('#cancel-section').hidden = !page.canCancel;

  // Contact
  const contact = [business.email, business.phone].filter(Boolean).join(' · ');
  $('#contact').textContent = `${business.name}: ${contact}`;
}

// --- Uploading a proof of payment (#70) --------------------------------------

const ERRORS = {
  FILE_MISSING: 'Please choose a file first.',
  FILE_INVALID: "We couldn't read that file. Please choose a PDF, JPEG or PNG.",
  UNSUPPORTED_FILE_TYPE: 'Please choose a PDF, JPEG or PNG file.',
  FILE_TOO_LARGE: 'That file is too big. The most you can upload is 5 MB.',
  PROOF_LIMIT_REACHED:
    "You've already uploaded the most proofs of payment allowed.",
  BOOKING_NOT_PENDING:
    'This booking is no longer waiting for a deposit, so a proof is not needed.',
  RATE_LIMITED: 'Too many attempts. Please try again in a little while.',
  LINK_NOT_VALID: "This link isn't valid any more.",
};

function setProgress(percent) {
  const bar = $('#progress-bar');
  bar.style.width = `${percent}%`;
  $('#progress').setAttribute('aria-valuenow', String(percent));
}

// Sends the file with an XMLHttpRequest, which (unlike fetch) reports how much
// has gone, so a phone on a slow connection shows progress
function send(file) {
  return new Promise((resolve) => {
    const body = new FormData();
    body.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', api('/proofs'));
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        setProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      let data;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        data = null;
      }
      resolve({ status: xhr.status, data });
    };
    xhr.onerror = () => resolve({ status: 0, data: null });
    xhr.send(body);
  });
}

$('#upload-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = $('#file');
  const error = $('#file-error');
  input.classList.remove('is-invalid');
  $('#message').replaceChildren();

  const file = input.files?.[0];
  if (!file) {
    input.classList.add('is-invalid');
    error.textContent = ERRORS.FILE_MISSING;
    return;
  }
  // A quick check before sending; the server checks again, from the file's bytes
  if (file.size > 5 * 1024 * 1024) {
    input.classList.add('is-invalid');
    error.textContent = ERRORS.FILE_TOO_LARGE;
    return;
  }

  const button = $('#upload-button');
  button.disabled = true;
  $('#progress').hidden = false;
  setProgress(0);

  const { status, data } = await send(file);
  button.disabled = false;
  $('#progress').hidden = true;

  if (status === 201) {
    input.value = '';
    await load();
    showMessage($('#message'), 'success', data.message);
    return;
  }
  if (status === 404) {
    showInvalid();
    return;
  }
  input.classList.add('is-invalid');
  error.textContent =
    status === 0
      ? "Can't reach the server. Check your connection and try again."
      : (ERRORS[data?.code] ?? 'Something went wrong. Please try again.');
  if (
    data?.code === 'PROOF_LIMIT_REACHED' ||
    data?.code === 'BOOKING_NOT_PENDING'
  ) {
    await load();
  }
});

// --- Cancelling (#73): a confirm step on the page, then a POST ---------------

$('#cancel-open').addEventListener('click', () => {
  $('#cancel-start').hidden = true;
  $('#cancel-confirm').hidden = false;
  $('#cancel-yes').focus();
});
$('#cancel-no').addEventListener('click', () => {
  $('#cancel-confirm').hidden = true;
  $('#cancel-start').hidden = false;
});
$('#cancel-yes').addEventListener('click', async () => {
  const button = $('#cancel-yes');
  button.disabled = true;
  let res;
  try {
    res = await fetch(api('/cancel'), { method: 'POST' });
  } catch {
    button.disabled = false;
    showMessage(
      $('#message'),
      'danger',
      "Can't reach the server. Check your connection and try again.",
    );
    return;
  }
  button.disabled = false;
  if (res.status === 404) {
    showInvalid();
    return;
  }
  if (!res.ok) {
    showMessage(
      $('#message'),
      'danger',
      'Something went wrong and your booking was not cancelled. Please try again.',
    );
    return;
  }
  const result = await res.json();
  showCancelled(result);
});

function showCancelled({ booking, refundDue, refundAmount }) {
  $('#pay-section').hidden = true;
  $('#upload-section').hidden = true;
  $('#cancel-section').hidden = true;
  $('#status').replaceChildren(statusBadge(booking.status));
  const refund = refundDue
    ? ` Your deposit of ${formatRand(refundAmount)} will be refunded. We'll be in touch to arrange it.`
    : '';
  showMessage(
    $('#message'),
    'success',
    `Your booking has been cancelled and the time released.${refund}`,
  );
  $('#message').scrollIntoView({ block: 'nearest' });
}

// --- Loading -----------------------------------------------------------------

function showInvalid() {
  $('#loading').hidden = true;
  $('#content').hidden = true;
  $('#invalid').hidden = false;
}

async function load() {
  let res;
  try {
    res = await fetch(api());
  } catch {
    $('#loading').hidden = true;
    $('#error').hidden = false;
    return;
  }
  if (res.status === 404) {
    showInvalid();
    return;
  }
  if (!res.ok) {
    $('#loading').hidden = true;
    $('#error').hidden = false;
    return;
  }
  page = await res.json();
  render();
  $('#loading').hidden = true;
  $('#content').hidden = false;
}

load();
