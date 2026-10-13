// The admin Availability page (A-6, #41): working hours and blocked times,
// through /api/admin/availability (#34) and /api/admin/blocked-times (#35).
// Changes show in the client's time list at once, because the client page
// asks the same API every time.
import { adminApi, currentUser } from '/js/admin.js';
import { el } from '/js/format.js';
import {
  addDays,
  formatDay,
  localDate,
  localTime,
  zonedTimeToUtc,
  zoneShortName,
} from '/js/time-zone.js';

const DAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];
const $ = (selector) => document.querySelector(selector);
const message = $('#page-message');
const removeModal = new bootstrap.Modal('#remove-modal');

let timeZone = 'Africa/Johannesburg';
let removingId = null;

function showMessage(text, kind = 'success') {
  const icons = {
    success: 'bi-check-circle',
    danger: 'bi-x-circle',
    warning: 'bi-exclamation-triangle',
    info: 'bi-info-circle',
  };
  const box = el('div', `alert alert-${kind} d-flex gap-2`);
  const icon = el('i', `bi ${icons[kind]}`);
  icon.setAttribute('aria-hidden', 'true');
  box.append(icon, el('span', '', text));
  message.replaceChildren(box);
}

const zoneName = () =>
  timeZone === 'Africa/Johannesburg'
    ? `South African time (${zoneShortName(timeZone)})`
    : `${timeZone} time (${zoneShortName(timeZone)})`;

// --- Working hours ---------------------------------------------------------

let week = [];

function renderHours() {
  $('#hours-zone').textContent = `Times are in ${zoneName()}.`;
  $('#hours-body').replaceChildren(
    ...week.map((day, index) => {
      const name = DAY_NAMES[day.dayOfWeek - 1];
      const tr = el('tr');
      tr.dataset.index = String(index);

      const dayCell = el('th', 'fw-semibold', name);
      dayCell.scope = 'row';

      const working = el('input', 'form-check-input');
      working.type = 'checkbox';
      working.checked = day.isWorkingDay;
      working.setAttribute('aria-label', `${name} working`);

      const from = timeInput(`${name} opens`, day.startTime, !day.isWorkingDay);
      const to = timeInput(`${name} closes`, day.endTime, !day.isWorkingDay);
      const error = el('div', 'invalid-feedback d-block');
      error.id = `hours-error-${index}`;

      // Unticking a day disables its times
      working.addEventListener('change', () => {
        from.disabled = to.disabled = !working.checked;
        if (!working.checked) from.value = to.value = '';
        else {
          from.value ||= '09:00';
          to.value ||= '17:00';
        }
        error.textContent = '';
      });

      const cell = (child) => {
        const td = el('td');
        td.append(child);
        return td;
      };
      const last = cell(to);
      last.append(error);
      tr.append(dayCell, cell(working), cell(from), last);
      return tr;
    }),
  );
}

function timeInput(label, value, disabled) {
  const input = el('input', 'form-control');
  input.type = 'time';
  input.value = value ?? '';
  input.disabled = disabled;
  input.setAttribute('aria-label', label);
  return input;
}

// Reads the table into the shape the API wants, checking the same rules
function readHours() {
  let valid = true;
  const days = [...$('#hours-body').children].map((tr) => {
    const [, workingCell, fromCell, toCell] = tr.children;
    const isWorkingDay = workingCell.querySelector('input').checked;
    const startTime = isWorkingDay
      ? fromCell.querySelector('input').value
      : null;
    const endTime = isWorkingDay ? toCell.querySelector('input').value : null;
    const error = toCell.querySelector('.invalid-feedback');
    error.textContent = '';
    if (isWorkingDay && (!startTime || !endTime)) {
      error.textContent = 'Enter an opening and a closing time.';
      valid = false;
    } else if (isWorkingDay && endTime <= startTime) {
      error.textContent = 'Closing time must be after opening time.';
      valid = false;
    }
    return {
      dayOfWeek: week[Number(tr.dataset.index)].dayOfWeek,
      isWorkingDay,
      startTime,
      endTime,
    };
  });
  return valid ? days : null;
}

$('#hours-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const days = readHours();
  if (!days) return;
  const button = $('#hours-save');
  button.disabled = true;
  button.textContent = 'Saving…';
  try {
    const result = await adminApi('PUT', '/api/admin/availability', { days });
    if (result.ok) {
      week = result.data.days;
      renderHours();
      showMessage(
        'Working hours saved. Clients see the new times straight away.',
      );
    } else if (result.data?.code === 'VALIDATION_FAILED') {
      // "days.2.endTime" → show it on row 2
      for (const { field, message: text } of result.data.details ?? []) {
        const row = /^days\.(\d+)\./.exec(field)?.[1];
        if (row !== undefined) $(`#hours-error-${row}`).textContent = text;
      }
    } else {
      showMessage(
        "Couldn't save the working hours. Please try again.",
        'danger',
      );
    }
  } finally {
    button.disabled = false;
    button.textContent = 'Save working hours';
  }
});

// --- Blocked times ---------------------------------------------------------

let blocks = [];

const shortDay = (date) =>
  formatDay(date, { weekday: 'short', day: 'numeric', month: 'short' });

// "Fri 16 Oct · whole day" or "Wed 21 Oct, 12:00–14:00", in the business time zone
function describe(block) {
  const start = new Date(block.startAt);
  const end = new Date(block.endAt);
  const startDay = localDate(start, timeZone);
  const endDay = localDate(end, timeZone);
  const startTime = localTime(start, timeZone);
  const endTime = localTime(end, timeZone);

  if (startTime === '00:00' && endTime === '00:00') {
    const lastDay = addDays(endDay, -1);
    return lastDay === startDay
      ? `${shortDay(startDay)} · whole day`
      : `${shortDay(startDay)} to ${shortDay(lastDay)} · whole days`;
  }
  if (startDay === endDay)
    return `${shortDay(startDay)}, ${startTime}–${endTime}`;
  return `${shortDay(startDay)} ${startTime} to ${shortDay(endDay)} ${endTime}`;
}

function renderBlocks() {
  $('#no-blocks').hidden = blocks.length > 0;
  $('#blocks').replaceChildren(
    ...blocks.map((block) => {
      const li = el(
        'li',
        'list-group-item d-flex justify-content-between align-items-center gap-3',
      );
      const text = el('span');
      text.append(el('strong', '', describe(block)));
      if (block.reason)
        text.append(document.createTextNode(` · ${block.reason}`));
      const remove = el(
        'button',
        'btn btn-link btn-sm p-0 flex-shrink-0',
        'Remove',
      );
      remove.type = 'button';
      remove.addEventListener('click', () => {
        removingId = block.id;
        $('#remove-what').textContent = describe(block);
        removeModal.show();
      });
      li.append(text, remove);
      return li;
    }),
  );
}

async function loadBlocks() {
  const { ok, data } = await adminApi('GET', '/api/admin/blocked-times');
  if (!ok) {
    showMessage(
      "Couldn't load the blocked times. Please refresh the page.",
      'danger',
    );
    return;
  }
  blocks = data.blockedTimes;
  renderBlocks();
}

// Whole day(s) or a time range
function blockType() {
  return document.querySelector('input[name="block-type"]:checked').value;
}
for (const radio of document.querySelectorAll('input[name="block-type"]')) {
  radio.addEventListener('change', () => {
    $('#days-fields').hidden = blockType() !== 'days';
    $('#range-fields').hidden = blockType() !== 'range';
    clearFieldErrors();
  });
}

function clearFieldErrors() {
  for (const input of document.querySelectorAll('#block-form .is-invalid')) {
    input.classList.remove('is-invalid');
  }
}
function fieldError(id, text) {
  $(`#${id}`).classList.add('is-invalid');
  $(`#${id}-error`).textContent = text;
}

// The block as UTC instants. A whole day is midnight to midnight in the
// business time zone (docs/api.md 7.14); the browser works that out.
function readBlock() {
  clearFieldErrors();
  let valid = true;
  const need = (id, text) => {
    if (!$(`#${id}`).value) {
      fieldError(id, text);
      valid = false;
    }
  };
  let startAt;
  let endAt;

  if (blockType() === 'days') {
    need('from-date', 'Choose the first day.');
    need('to-date', 'Choose the last day.');
    if (valid && $('#to-date').value < $('#from-date').value) {
      fieldError('to-date', 'The last day must be on or after the first day.');
      valid = false;
    }
    if (valid) {
      startAt = zonedTimeToUtc($('#from-date').value, '00:00', timeZone);
      endAt = zonedTimeToUtc(
        addDays($('#to-date').value, 1),
        '00:00',
        timeZone,
      );
    }
  } else {
    need('range-date', 'Choose the date.');
    need('range-from', 'Choose a start time.');
    need('range-to', 'Choose an end time.');
    if (valid && $('#range-to').value <= $('#range-from').value) {
      fieldError('range-to', 'The end must be after the start.');
      valid = false;
    }
    if (valid) {
      startAt = zonedTimeToUtc(
        $('#range-date').value,
        $('#range-from').value,
        timeZone,
      );
      endAt = zonedTimeToUtc(
        $('#range-date').value,
        $('#range-to').value,
        timeZone,
      );
    }
  }
  if (!valid) return null;
  const reason = $('#reason').value.trim();
  const iso = (date) => date.toISOString().replace(/\.000Z$/, 'Z');
  return {
    startAt: iso(startAt),
    endAt: iso(endAt),
    ...(reason ? { reason } : {}),
  };
}

$('#block-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = readBlock();
  if (!payload) return;
  const button = $('#block-button');
  button.disabled = true;
  button.textContent = 'Blocking…';
  try {
    const result = await adminApi('POST', '/api/admin/blocked-times', payload);
    if (!result.ok) {
      showMessage(
        result.data?.details?.map((d) => d.message).join(' ') ||
          "Couldn't block that time. Please try again.",
        'danger',
      );
      return;
    }
    $('#reason').value = '';
    await loadBlocks();
    const clashes = result.data.overlappingBookings;
    if (clashes.length) {
      showMessage(
        `Blocked. These bookings fall in this time and were not cancelled: ${clashes.join(', ')}. Contact the client or cancel the booking if needed.`,
        'warning',
      );
    } else {
      showMessage('Blocked. Clients can no longer book that time.');
    }
  } finally {
    button.disabled = false;
    button.textContent = 'Block';
  }
});

$('#confirm-remove').addEventListener('click', async () => {
  const result = await adminApi(
    'DELETE',
    `/api/admin/blocked-times/${removingId}`,
  );
  removeModal.hide();
  if (!result.ok) {
    showMessage("Couldn't remove the block. Please try again.", 'danger');
    return;
  }
  await loadBlocks();
  showMessage('Removed. That time can be booked again.');
});

// --- Start -----------------------------------------------------------------

async function load() {
  const result = await adminApi('GET', '/api/admin/availability');
  $('#page-loading').hidden = true;
  if (!result.ok) {
    showMessage(
      "Couldn't load the working hours. Please refresh the page.",
      'danger',
    );
    return;
  }
  timeZone = result.data.timeZone;
  week = result.data.days;
  $('#content').hidden = false;
  renderHours();
  await loadBlocks();
}

currentUser.then(load);
