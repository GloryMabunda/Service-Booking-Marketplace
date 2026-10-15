// The admin services page (A-5, #31): list, add, edit, activate or deactivate,
// and delete services through /api/admin/services (#30).
import { adminApi, currentUser } from '/js/admin.js';
import { el, formatDuration, formatRand } from '/js/format.js';

const body = document.querySelector('#services-body');
const tableWrap = document.querySelector('#table-wrap');
const loading = document.querySelector('#table-loading');
const noServices = document.querySelector('#no-services');
const message = document.querySelector('#page-message');

const serviceModal = new bootstrap.Modal('#service-modal');
const deleteModal = new bootstrap.Modal('#delete-modal');
const form = document.querySelector('#service-form');
const saveButton = document.querySelector('#save-button');

// API field name → the form input and its error line
const FIELDS = {
  name: 'svc-name',
  description: 'svc-description',
  price: 'svc-price',
  durationMinutes: 'svc-duration',
};

let services = [];
let editingId = null; // null while adding a new service
let deletingId = null;

// --- Talking to the API ---------------------------------------------------

const api = (method, path, payload) =>
  adminApi(method, `/api/admin/services${path}`, payload);

// --- The table ------------------------------------------------------------

function statusBadge(isActive) {
  const badge = el(
    'span',
    `mbg-badge ${isActive ? 'mbg-badge-active' : 'mbg-badge-inactive'}`,
  );
  badge.append(
    el('i', `bi ${isActive ? 'bi-check-circle' : 'bi-eye-slash'}`),
    document.createTextNode(isActive ? 'Active' : 'Inactive'),
  );
  badge.firstChild.setAttribute('aria-hidden', 'true');
  return badge;
}

function linkButton(label, onClick) {
  const button = el('button', 'btn btn-link btn-sm p-0 align-baseline', label);
  button.type = 'button';
  button.addEventListener('click', onClick);
  return button;
}

function row(service) {
  const tr = el('tr', service.isActive ? '' : 'mbg-row-inactive');
  const name = el('th', 'fw-semibold');
  name.scope = 'row';
  if (service.image) {
    const thumb = el('img', 'rounded me-2 align-middle');
    thumb.src = service.image.thumb.url;
    thumb.alt = '';
    thumb.width = 40;
    thumb.height = 30;
    thumb.style.objectFit = 'cover';
    name.append(thumb);
  }
  name.append(document.createTextNode(service.name));
  tr.append(
    name,
    el('td', '', formatDuration(service.durationMinutes)),
    el('td', '', formatRand(service.price)),
    el('td', '', String(service.bookingCount)),
  );
  const status = el('td');
  status.append(statusBadge(service.isActive));
  tr.append(status);

  const actions = el('td', 'text-nowrap text-end');
  const dot = () => el('span', 'text-secondary mx-1', '·');
  actions.append(
    linkButton('Edit', () => openForm(service)),
    dot(),
    linkButton(service.isActive ? 'Deactivate' : 'Activate', () =>
      setActive(service, !service.isActive),
    ),
  );
  // A service nobody has booked can be deleted; one with bookings can only be
  // deactivated (the API makes the same rule).
  if (service.bookingCount === 0) {
    actions.append(
      dot(),
      linkButton('Delete', () => askDelete(service)),
    );
  }
  tr.append(actions);
  return tr;
}

function render() {
  body.replaceChildren(...services.map(row));
  tableWrap.hidden = services.length === 0;
  noServices.hidden = services.length !== 0;
}

function showMessage(text, kind = 'success') {
  const icon = kind === 'success' ? 'bi-check-circle' : 'bi-x-circle';
  const box = el('div', `alert alert-${kind} d-flex gap-2`);
  box.append(el('i', `bi ${icon}`), el('span', '', text));
  box.firstChild.setAttribute('aria-hidden', 'true');
  message.replaceChildren(box);
}

async function load() {
  const { ok, data } = await api('GET', '');
  loading.hidden = true;
  if (!ok) {
    showMessage(
      "Couldn't load the services. Please refresh the page.",
      'danger',
    );
    return;
  }
  services = data.services;
  render();
}

// --- Add and edit ---------------------------------------------------------

function clearErrors() {
  document.querySelector('#form-error').classList.add('d-none');
  for (const input of form.querySelectorAll('.is-invalid')) {
    input.classList.remove('is-invalid');
  }
}

function fieldError(apiField, text) {
  const id = FIELDS[apiField];
  const input = document.querySelector(`#${id}`);
  if (!input) return false;
  input.classList.add('is-invalid');
  document.querySelector(`#${id}-error`).textContent = text;
  return true;
}

function openForm(service) {
  editingId = service ? service.id : null;
  clearErrors();
  document.querySelector('#service-modal-title').textContent = service
    ? 'Edit service'
    : 'Add service';
  document.querySelector('#svc-name').value = service ? service.name : '';
  document.querySelector('#svc-description').value = service
    ? service.description
    : '';
  document.querySelector('#svc-price').value = service ? service.price : '';
  document.querySelector('#svc-duration').value = service
    ? service.durationMinutes
    : '';
  document.querySelector('#svc-active').checked = service
    ? service.isActive
    : true;
  showCurrentPhoto(service?.image ?? null);
  document.querySelector('#svc-travel').checked = service
    ? service.availableForTravel
    : false;
  serviceModal.show();
}

// --- The service's picture --------------------------------------------------

const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
const photoInput = document.querySelector('#svc-photo');
const photoPreview = document.querySelector('#svc-photo-preview');

function showCurrentPhoto(image) {
  photoInput.value = '';
  photoInput.classList.remove('is-invalid');
  document.querySelector('#svc-photo-alt').value = image?.altText ?? '';
  document.querySelector('#svc-photo-remove').checked = false;
  document.querySelector('#svc-photo-remove-row').hidden = !image;
  photoPreview.hidden = !image;
  if (image) photoPreview.src = image.thumb.url;
}

// A chosen file is previewed at once, before anything is sent
photoInput.addEventListener('change', () => {
  const file = photoInput.files?.[0];
  photoInput.classList.remove('is-invalid');
  if (!file) return;
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
    photoInput.classList.add('is-invalid');
    document.querySelector('#svc-photo-error').textContent =
      'Choose a JPEG, PNG or WebP picture.';
    photoInput.value = '';
    return;
  }
  if (file.size > MAX_PHOTO_BYTES) {
    photoInput.classList.add('is-invalid');
    document.querySelector('#svc-photo-error').textContent =
      'The picture must be 15 MB or smaller.';
    photoInput.value = '';
    return;
  }
  // A data: address, because the page's content policy allows no blob: pictures
  const reader = new FileReader();
  reader.onload = () => {
    photoPreview.src = String(reader.result);
    photoPreview.hidden = false;
  };
  reader.readAsDataURL(file);
  document.querySelector('#svc-photo-remove').checked = false;
});

// Sends the chosen picture (or removes the current one) for a saved service.
// Returns the updated service, or a sentence saying what went wrong.
async function savePhoto(saved) {
  const file = photoInput.files?.[0];
  if (file) {
    const data = new FormData();
    data.append('file', file);
    const alt = document.querySelector('#svc-photo-alt').value.trim();
    if (alt) data.append('altText', alt);
    const res = await fetch(`/api/admin/services/${saved.id}/image`, {
      method: 'PUT',
      body: data,
    });
    const body = await res.json().catch(() => null);
    if (res.ok) return { service: body.service };
    return { problem: body?.message ?? "the picture couldn't be uploaded" };
  }
  if (document.querySelector('#svc-photo-remove').checked && saved.image) {
    const result = await api('DELETE', `/${saved.id}/image`);
    if (result.ok) return { service: { ...saved, image: null } };
    return { problem: "the picture couldn't be removed" };
  }
  return { service: saved };
}

// The same rules as the API (docs/api.md 7.12), so mistakes show up before
// anything is sent. The server checks everything again.
function readForm() {
  const name = document.querySelector('#svc-name').value.trim();
  const description = document.querySelector('#svc-description').value.trim();
  const price = document.querySelector('#svc-price').value.trim();
  const durationText = document.querySelector('#svc-duration').value.trim();
  const duration = Number(durationText);

  let valid = true;
  const check = (field, ok, text) => {
    if (!ok) {
      fieldError(field, text);
      valid = false;
    }
  };
  check('name', name.length >= 1, 'Enter the service name.');
  check('name', name.length <= 100, 'The name must be at most 100 characters.');
  check(
    'description',
    description.length <= 2000,
    'The description must be at most 2,000 characters.',
  );
  check(
    'price',
    /^\d{1,8}(\.\d{1,2})?$/.test(price),
    'Enter a price such as "650.00".',
  );
  check(
    'durationMinutes',
    durationText !== '' &&
      Number.isInteger(duration) &&
      duration >= 1 &&
      duration <= 720,
    'The duration must be a whole number between 1 and 720 minutes.',
  );
  if (!valid) return null;
  return {
    name,
    description,
    price,
    durationMinutes: duration,
    isActive: document.querySelector('#svc-active').checked,
    availableForTravel: document.querySelector('#svc-travel').checked,
  };
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearErrors();
  const payload = readForm();
  if (!payload) return;

  saveButton.disabled = true;
  saveButton.textContent = 'Saving…';
  try {
    const result = editingId
      ? await api('PATCH', `/${editingId}`, payload)
      : await api('POST', '', payload);

    if (result.ok) {
      let saved = result.data.service;
      const photo = await savePhoto(saved);
      if (photo.service) saved = photo.service;
      services = editingId
        ? services.map((s) => (s.id === saved.id ? saved : s))
        : [...services, saved];
      services.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
      );
      render();
      serviceModal.hide();
      showMessage(editingId ? `Saved ${saved.name}.` : `Added ${saved.name}.`);
      if (photo.problem) {
        showMessage(
          `${saved.name} was saved, but ${photo.problem}. Open it again to retry.`,
          'warning',
        );
      }
      return;
    }

    if (result.data?.code === 'SERVICE_NAME_TAKEN') {
      fieldError('name', 'Another service already has this name.');
    } else if (result.data?.code === 'VALIDATION_FAILED') {
      const unplaced = [];
      for (const { field, message: text } of result.data.details ?? []) {
        if (!fieldError(field, text)) unplaced.push(text);
      }
      if (unplaced.length) showFormError(unplaced.join(' '));
    } else {
      showFormError('Something went wrong. Please try again.');
    }
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = 'Save';
  }
});

function showFormError(text) {
  document.querySelector('#form-error-text').textContent = text;
  document.querySelector('#form-error').classList.remove('d-none');
  document.querySelector('#form-error').classList.add('d-flex');
}

// --- Activate, deactivate, delete -----------------------------------------

async function setActive(service, isActive) {
  const result = await api('PATCH', `/${service.id}`, { isActive });
  if (!result.ok) {
    showMessage(`Couldn't update ${service.name}. Please try again.`, 'danger');
    return;
  }
  services = services.map((s) =>
    s.id === service.id ? result.data.service : s,
  );
  render();
  showMessage(
    isActive
      ? `${service.name} is active. Clients can see and book it.`
      : `${service.name} is inactive. Clients can't see or book it; existing bookings stay.`,
  );
}

function askDelete(service) {
  deletingId = service.id;
  document.querySelector('#delete-name').textContent = service.name;
  deleteModal.show();
}

document
  .querySelector('#confirm-delete')
  .addEventListener('click', async () => {
    const service = services.find((s) => s.id === deletingId);
    const result = await api('DELETE', `/${deletingId}`);
    deleteModal.hide();
    if (!result.ok) {
      showMessage("Couldn't delete the service. Please try again.", 'danger');
      return;
    }
    if (result.data?.deactivated) {
      // Someone booked it just now, so it was deactivated instead of deleted.
      services = services.map((s) =>
        s.id === deletingId ? result.data.service : s,
      );
      showMessage(
        `${service.name} has bookings, so it was made inactive instead of deleted.`,
        'info',
      );
    } else {
      services = services.filter((s) => s.id !== deletingId);
      showMessage(`Deleted ${service.name}.`);
    }
    render();
  });

document
  .querySelector('#add-service')
  .addEventListener('click', () => openForm(null));

currentUser.then(load);
