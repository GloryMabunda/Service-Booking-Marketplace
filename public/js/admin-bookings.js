// The bookings list (A-3, #63): filters, search and paging over
// /api/admin/bookings. The filters live in the address (?status=pending&q=…),
// so a filtered list can be bookmarked and the dashboard can link to one.
import { adminApi } from '/js/admin.js';
import { el } from '/js/format.js';
import {
  apiProblem,
  loadTimeZone,
  PAYMENT,
  showMessage,
  STATUSES,
  statusBadge,
  whenText,
} from '/js/admin-bookings-shared.js';

const $ = (selector) => document.querySelector(selector);
const form = $('#filters');
const PAGE_SIZE = 25;

let timeZone = 'Africa/Johannesburg';
let page = 1;

// --- The filters, kept in the address ----------------------------------------

function buildStatusChecks() {
  $('#status-checks').replaceChildren(
    ...Object.entries(STATUSES).map(([value, [label]]) => {
      const wrap = el('div', 'form-check');
      const input = el('input', 'form-check-input');
      input.type = 'checkbox';
      input.id = `status-${value}`;
      input.value = value;
      const lab = el('label', 'form-check-label', label);
      lab.htmlFor = input.id;
      wrap.append(input, lab);
      return wrap;
    }),
  );
}

function readAddress() {
  const params = new URLSearchParams(location.search);
  const chosen = (params.get('status') ?? '').split(',');
  for (const box of document.querySelectorAll('#status-checks input')) {
    box.checked = chosen.includes(box.value);
  }
  $('#from').value = params.get('from') ?? '';
  $('#to').value = params.get('to') ?? '';
  $('#q').value = params.get('q') ?? '';
  $('#sort').value = params.get('sort') ?? 'startAt';
  $('#proof').checked = params.get('proof') === 'received';
  page = Number(params.get('page')) || 1;
}

// The filters as the query the API takes (empty ones are left out)
function currentParams() {
  const params = new URLSearchParams();
  const statuses = [
    ...document.querySelectorAll('#status-checks input:checked'),
  ]
    .map((box) => box.value)
    .join(',');
  if (statuses) params.set('status', statuses);
  if ($('#from').value) params.set('from', $('#from').value);
  if ($('#to').value) params.set('to', $('#to').value);
  if ($('#q').value.trim()) params.set('q', $('#q').value.trim());
  if ($('#sort').value !== 'startAt') params.set('sort', $('#sort').value);
  if ($('#proof').checked) params.set('proof', 'received');
  if (page > 1) params.set('page', String(page));
  return params;
}

// --- Loading and showing the list --------------------------------------------

function clearErrors() {
  for (const input of form.querySelectorAll('.is-invalid')) {
    input.classList.remove('is-invalid');
  }
  $('#page-message').replaceChildren();
}

function row(booking) {
  const tr = el('tr');
  const reference = el('td');
  const link = el('a', 'font-monospace', booking.reference);
  link.href = `/admin/booking.html?id=${encodeURIComponent(booking.id)}`;
  reference.append(link);

  const client = el('td');
  client.append(el('div', '', booking.client.name));
  client.append(el('div', 'small text-secondary', booking.client.email));

  const status = el('td');
  status.append(statusBadge(booking.status));

  tr.append(
    reference,
    client,
    el('td', '', booking.service.name),
    el('td', '', whenText(booking.startAt, timeZone)),
    status,
    el('td', '', PAYMENT[booking.paymentStatus]),
  );
  return tr;
}

async function load() {
  clearErrors();
  const params = currentParams();
  history.replaceState(null, '', `${location.pathname}?${params}`);
  const api = new URLSearchParams(params);
  api.set('pageSize', String(PAGE_SIZE));

  $('#loading').hidden = false;
  $('#table-wrap').hidden = true;
  $('#no-results').hidden = true;
  $('#pager').hidden = true;
  $('#summary').textContent = '';

  const { ok, status, data } = await adminApi(
    'GET',
    `/api/admin/bookings?${api}`,
  );
  $('#loading').hidden = true;

  if (!ok) {
    if (status === 400) {
      for (const { field, message } of data?.details ?? []) {
        const input = $(`#${field}`);
        if (input) {
          input.classList.add('is-invalid');
          const error = $(`#${field}-error`);
          if (error) error.textContent = message;
        }
      }
    }
    showMessage(
      $('#page-message'),
      'danger',
      apiProblem(data, "The bookings couldn't be loaded. Please try again."),
    );
    return;
  }

  $('#bookings-body').replaceChildren(...data.items.map(row));
  $('#table-wrap').hidden = data.items.length === 0;
  $('#no-results').hidden = data.items.length > 0;

  const first = (data.page - 1) * data.pageSize + 1;
  const last = first + data.items.length - 1;
  $('#summary').textContent =
    data.total === 0
      ? ''
      : `Showing ${first}–${last} of ${data.total} booking${data.total === 1 ? '' : 's'}`;
  $('#prev').disabled = data.page <= 1;
  $('#next').disabled = data.page * data.pageSize >= data.total;
  $('#pager').hidden = data.total <= data.pageSize;
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  page = 1;
  load();
});
$('#clear').addEventListener('click', () => {
  history.replaceState(null, '', location.pathname);
  readAddress();
  load();
});
$('#prev').addEventListener('click', () => {
  page -= 1;
  load();
});
$('#next').addEventListener('click', () => {
  page += 1;
  load();
});

buildStatusChecks();
readAddress();
loadTimeZone().then((zone) => {
  timeZone = zone;
  load();
});
