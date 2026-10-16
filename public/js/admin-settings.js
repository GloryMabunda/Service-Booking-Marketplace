// The settings page (A-8, #75): every business setting, edited through
// /api/admin/settings (#28). The form is built from the list below, so each
// setting has one label, one hint and one error line. The server checks every
// value again; its messages are shown next to the field they belong to.
import { adminApi } from '/js/admin.js';
import { el } from '/js/format.js';
import { apiProblem, showMessage } from '/js/admin-bookings-shared.js';

const $ = (selector) => document.querySelector(selector);
const form = $('#settings-form');

// type: text | number | percent | money | checkbox | phone | optional
// path: the field in the API ("bankingDetails.bank" is inside bankingDetails)
const SECTIONS = [
  {
    title: 'Your business',
    fields: [
      {
        path: 'businessName',
        label: 'Business name',
        type: 'text',
        hint: 'Shown in the header and footer, in page titles and in every email. Add your logo under Website.',
      },
      {
        path: 'businessEmail',
        label: 'Business email',
        type: 'email',
        hint: 'Clients reply to this address, and new-booking emails come here.',
      },
      {
        path: 'businessPhone',
        label: 'Business phone (optional)',
        type: 'phone',
        hint: 'A South African number, such as 082 123 4567.',
      },
    ],
  },
  {
    title: 'Banking details',
    intro:
      'Shown to clients in the payment instructions email, so they can pay their deposit by EFT.',
    fields: [
      {
        path: 'bankingDetails.accountName',
        label: 'Account name',
        type: 'text',
      },
      { path: 'bankingDetails.bank', label: 'Bank', type: 'text' },
      {
        path: 'bankingDetails.accountNumber',
        label: 'Account number',
        type: 'text',
        inputmode: 'numeric',
      },
      {
        path: 'bankingDetails.branchCode',
        label: 'Branch code',
        type: 'text',
        inputmode: 'numeric',
      },
      {
        path: 'bankingDetails.accountType',
        label: 'Account type',
        type: 'text',
        hint: 'For example Cheque or Savings.',
      },
    ],
  },
  {
    title: 'When clients can book',
    fields: [
      {
        path: 'timeZone',
        label: 'Time zone',
        type: 'text',
        hint: 'For example Africa/Johannesburg.',
      },
      {
        path: 'minNoticeHours',
        label: 'Minimum notice (hours)',
        type: 'number',
        hint: "0 to 720. A client can't book sooner than this before the appointment.",
      },
      {
        path: 'maxAdvanceDays',
        label: 'Furthest ahead (days)',
        type: 'number',
        hint: '1 to 365.',
      },
      {
        path: 'slotIntervalMinutes',
        label: 'Start times every (minutes)',
        type: 'number',
        hint: 'A multiple of 5, such as 60 for 09:00, 10:00, 11:00.',
      },
      {
        path: 'bufferMinutes',
        label: 'Time between appointments (minutes)',
        type: 'number',
        hint: '0 to 240. Kept free after each appointment.',
      },
    ],
  },
  {
    title: 'Deposits and refunds',
    fields: [
      {
        path: 'depositPercent',
        label: 'Deposit (% of the price)',
        type: 'percent',
        hint: '0 to 100. At 0 no deposit is needed and bookings are confirmed straight away.',
      },
      {
        path: 'depositHoldHours',
        label: 'Time to pay the deposit (hours)',
        type: 'number',
        hint: '1 to 168. After this an unpaid booking expires and the time is released.',
      },
      {
        path: 'minPaymentWindowHours',
        label: 'Shortest payment window (hours)',
        type: 'number',
        hint: '1 to 72, and no more than the time to pay. Times too close to the appointment to pay in are not offered.',
      },
      {
        path: 'depositRefundable',
        label: 'Deposits are refundable',
        type: 'checkbox',
      },
      {
        path: 'refundCutoffHours',
        label: 'Refund if cancelled at least (hours before)',
        type: 'number',
        hint: '0 to 720.',
      },
    ],
  },
  {
    title: 'Travel to clients',
    intro:
      "Clients can ask you to come to them, for the services you allow it on. The travel fee is a call-out fee plus a rate per km from your home, worked out from the client's address, and is paid with the deposit. Leave the home address empty to turn travel off.",
    fields: [
      {
        path: 'homeAddress',
        label: 'Your home address',
        type: 'optional',
        hint: 'Private. Distances are measured from here. Only you, and clients who come to you, ever see it, in their booking emails.',
      },
      {
        path: 'travelCallOutFee',
        label: 'Call-out fee (R)',
        type: 'money',
        hint: 'Charged on every travel booking, for example 50.00.',
      },
      {
        path: 'travelRatePerKm',
        label: 'Rate per km (R)',
        type: 'money',
        hint: 'The SARS rate for 2026/27 is R4.95 per km, a good guide.',
      },
      {
        path: 'travelFreeKm',
        label: 'Free kilometres',
        type: 'number',
        hint: '0 to 500. Not charged for, counted before the rate applies.',
      },
      {
        path: 'travelMaxKm',
        label: 'Furthest you travel (km)',
        type: 'number',
        hint: '1 to 500, one way by road. Further addresses are refused.',
      },
      {
        path: 'travelChargeReturn',
        label: 'Charge for the trip back as well',
        type: 'checkbox',
      },
      {
        path: 'travelExtraMinutes',
        label: 'Extra travel time (minutes)',
        type: 'number',
        hint: '0 to 240. Kept free before and after a travel appointment, so you are never booked back to back across town.',
      },
    ],
  },
];

const FIELDS = SECTIONS.flatMap((section) => section.fields);
const idOf = (path) => `s-${path.replace('.', '-')}`;

function build() {
  const parts = SECTIONS.map((section) => {
    const fieldset = el('fieldset', 'mb-4');
    fieldset.append(el('legend', 'h4 mbg-form-legend', section.title));
    if (section.intro)
      fieldset.append(el('p', 'text-secondary', section.intro));
    for (const field of section.fields) fieldset.append(fieldRow(field));
    return fieldset;
  });

  const save = el('button', 'btn btn-primary', 'Save settings');
  save.type = 'submit';
  save.id = 'save-button';
  parts.push(save);
  form.replaceChildren(...parts);
}

function fieldRow(field) {
  const id = idOf(field.path);
  const wrap = el(
    'div',
    field.type === 'checkbox' ? 'form-check mb-3' : 'mb-3',
  );
  const input = el(
    'input',
    field.type === 'checkbox' ? 'form-check-input' : 'form-control',
  );
  input.id = id;
  input.type =
    field.type === 'checkbox'
      ? 'checkbox'
      : field.type === 'email'
        ? 'email'
        : 'text';
  if (field.inputmode) input.inputMode = field.inputmode;
  else if (field.type === 'number') input.inputMode = 'numeric';
  else if (field.type === 'percent' || field.type === 'money')
    input.inputMode = 'decimal';
  input.autocomplete = 'off';

  const label = el(
    'label',
    field.type === 'checkbox' ? 'form-check-label' : 'form-label',
    field.label,
  );
  label.htmlFor = id;
  const error = el('div', 'invalid-feedback');
  error.id = `${id}-error`;

  if (field.type === 'checkbox') {
    wrap.append(input, label, error);
  } else {
    wrap.append(label, input);
    if (field.hint) {
      const hint = el('div', 'form-text', field.hint);
      hint.id = `${id}-hint`;
      input.setAttribute('aria-describedby', hint.id);
      wrap.append(hint);
    }
    wrap.append(error);
  }
  return wrap;
}

// --- Filling the form and reading it back -------------------------------------

const valueAt = (settings, path) =>
  path.split('.').reduce((value, key) => value?.[key], settings);

function fill(settings) {
  for (const field of FIELDS) {
    const input = $(`#${idOf(field.path)}`);
    const value = valueAt(settings, field.path);
    if (field.type === 'checkbox') input.checked = value === true;
    else input.value = value ?? '';
  }
  warnAboutBanking(settings.bankingDetails);
}

// The seed leaves every banking field as "Not set yet" (#28)
function warnAboutBanking(details) {
  const unset = Object.values(details).some(
    (value) => !value.trim() || value.trim().toLowerCase() === 'not set yet',
  );
  const box = $('#page-message');
  if (unset) {
    showMessage(
      box,
      'warning',
      "Your banking details aren't set yet. Until they are, clients can't book a service that needs a deposit.",
    );
  }
}

function read() {
  const payload = { bankingDetails: {} };
  for (const field of FIELDS) {
    const input = $(`#${idOf(field.path)}`);
    let value;
    if (field.type === 'checkbox') value = input.checked;
    else if (field.type === 'number') {
      const text = input.value.trim();
      // Anything that isn't a whole number goes to the server as text, which
      // refuses it with the right message
      value = /^\d+$/.test(text) ? Number(text) : text;
    } else if (field.type === 'phone' || field.type === 'optional')
      value = input.value.trim() || null;
    else value = input.value.trim();

    const [head, tail] = field.path.split('.');
    if (tail) payload[head][tail] = value;
    else payload[head] = value;
  }
  return payload;
}

// --- Saving -------------------------------------------------------------------

function clearErrors() {
  for (const input of form.querySelectorAll('.is-invalid')) {
    input.classList.remove('is-invalid');
  }
  $('#page-message').replaceChildren();
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearErrors();
  const button = $('#save-button');
  button.disabled = true;
  const { ok, status, data } = await adminApi(
    'PATCH',
    '/api/admin/settings',
    read(),
  );
  button.disabled = false;

  if (ok) {
    fill(data.settings);
    // fill() may have shown the banking warning; the success note goes first
    const warning = $('#page-message').firstChild;
    showMessage($('#page-message'), 'success', 'Your settings were saved.');
    if (warning) $('#page-message').append(warning);
    return;
  }

  if (status === 400 && Array.isArray(data?.details)) {
    let first = null;
    const unplaced = [];
    for (const { field, message } of data.details) {
      // "bankingDetails.accountName" is the field; "bankingDetails" alone is
      // the group (a missing or extra field)
      const input = FIELDS.some((f) => f.path === field)
        ? $(`#${idOf(field)}`)
        : null;
      if (input) {
        input.classList.add('is-invalid');
        $(`#${idOf(field)}-error`).textContent = message;
        first ??= input;
      } else {
        unplaced.push(message);
      }
    }
    if (unplaced.length) {
      showMessage($('#page-message'), 'danger', unplaced.join(' '));
    } else {
      showMessage(
        $('#page-message'),
        'danger',
        'Please check the highlighted settings.',
      );
    }
    first?.focus();
    return;
  }
  showMessage(
    $('#page-message'),
    'danger',
    apiProblem(
      data,
      'Something went wrong. Your settings were not saved. Please try again.',
    ),
  );
});

// --- Loading ------------------------------------------------------------------

async function load() {
  const { ok, data } = await adminApi('GET', '/api/admin/settings');
  $('#loading').hidden = true;
  if (!ok) {
    showMessage(
      $('#page-message'),
      'danger',
      "The settings couldn't be loaded. Please refresh the page.",
    );
    return;
  }
  build();
  fill(data.settings);
  form.hidden = false;
}

load();
