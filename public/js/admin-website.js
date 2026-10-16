// The Website page in the admin portal (A-10, #108): everything on the home
// page the owner manages. About and contact, the hero and About photos, the
// gallery, testimonials and FAQ, through /api/admin/site-content, /gallery,
// /testimonials and /faqs. The server checks every value again; its messages
// are shown beside the field they belong to.
import { adminApi } from '/js/admin.js';
import { el } from '/js/format.js';
import { apiProblem, showMessage } from '/js/admin-bookings-shared.js';

const $ = (selector) => document.querySelector(selector);
const deleteModal = new bootstrap.Modal('#delete-modal');

let services = [];
let content = null;
let galleryItems = [];

// --- Small helpers ---------------------------------------------------------

function say(kind, text) {
  showMessage($('#page-message'), kind, text);
  if (kind === 'success') {
    // "Saved" fades after a moment so it doesn't pile up
    clearTimeout(say.timer);
    say.timer = setTimeout(() => $('#page-message').replaceChildren(), 3000);
  }
}

function clearErrors(root) {
  for (const input of root.querySelectorAll('.is-invalid')) {
    input.classList.remove('is-invalid');
  }
  $('#page-message').replaceChildren();
}

// Puts the server's messages next to their fields. `ids` maps an API field to
// the id of its input; anything that has no field is shown at the top.
function showFieldErrors(details, ids) {
  const loose = [];
  let first = null;
  for (const { field, message } of details ?? []) {
    const id = ids[field];
    const input = id ? $(`#${id}`) : null;
    if (input) {
      input.classList.add('is-invalid');
      const error = $(`#${id}-error`);
      if (error) error.textContent = message;
      first ??= input;
    } else {
      loose.push(message);
    }
  }
  if (loose.length) say('danger', loose.join(' '));
  else if (!first) say('danger', 'Please check what you entered.');
  first?.focus();
}

// Sends a file upload with progress (XMLHttpRequest, unlike fetch, reports how
// much has gone)
function sendForm(method, url, body, onProgress) {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(event.loaded, event.total);
      };
    }
    xhr.onload = () => {
      if (xhr.status === 401) {
        location.assign(
          `/admin/login.html?next=${encodeURIComponent(location.pathname)}`,
        );
        return;
      }
      let data;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        data = null;
      }
      resolve({ ok: xhr.status < 300, status: xhr.status, data });
    };
    xhr.onerror = () => resolve({ ok: false, status: 0, data: null });
    xhr.send(body);
  });
}

function confirmDelete(title, text, run) {
  $('#delete-title').textContent = title;
  $('#delete-text').textContent = text;
  const yes = $('#delete-yes');
  const fresh = yes.cloneNode(true); // drops the last handler
  yes.replaceWith(fresh);
  fresh.addEventListener('click', async () => {
    fresh.disabled = true;
    await run();
    fresh.disabled = false;
    deleteModal.hide();
  });
  deleteModal.show();
}

// Drag-and-drop ordering of the children of `container` that match `selector`.
// `onOrder` gets the ids, first to last. Buttons do the same for keyboard and
// phone users, so dragging is a convenience, never the only way.
function dragReorder(container, selector, onOrder) {
  let dragged = null;
  for (const item of container.querySelectorAll(selector)) {
    item.draggable = true;
    item.addEventListener('dragstart', (event) => {
      dragged = item;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', item.dataset.id);
      item.classList.add('opacity-50');
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('opacity-50');
      dragged = null;
    });
    item.addEventListener('dragover', (event) => {
      if (dragged && dragged !== item) event.preventDefault();
    });
    item.addEventListener('drop', (event) => {
      event.preventDefault();
      if (!dragged || dragged === item) return;
      const ids = [...container.querySelectorAll(selector)].map(
        (n) => n.dataset.id,
      );
      const from = ids.indexOf(dragged.dataset.id);
      const to = ids.indexOf(item.dataset.id);
      ids.splice(to, 0, ids.splice(from, 1)[0]);
      onOrder(ids);
    });
  }
}

// Moves one id a step earlier or later in a list of ids
function moved(ids, id, by) {
  const next = [...ids];
  const from = next.indexOf(id);
  const to = from + by;
  if (to < 0 || to >= next.length) return null;
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}

function serviceOptions(select, selectedId, noneLabel) {
  select.replaceChildren(
    new Option(noneLabel, ''),
    ...services.map((s) => new Option(s.name, s.id)),
  );
  select.value = selectedId ?? '';
}

function iconButton(
  iconName,
  label,
  onClick,
  className = 'btn btn-outline-primary btn-sm',
) {
  const button = el('button', className);
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.title = label;
  const mark = el('i', `bi ${iconName}`);
  mark.setAttribute('aria-hidden', 'true');
  button.append(mark);
  button.addEventListener('click', onClick);
  return button;
}

// --- About: tagline, text and the two photos ----------------------------------

const SLOTS = [
  {
    slot: 'logo',
    label: 'Logo',
    key: 'logoImage',
    alt: 'logoImageAlt',
    hint: 'Shown in the header, the footer and the home page. A PNG with a transparent background looks best. Without one, your business name is shown as text. The business name itself is set in Settings.',
  },
  { slot: 'hero', label: 'Hero photo', key: 'heroImage', alt: 'heroImageAlt' },
  {
    slot: 'about',
    label: 'About photo',
    key: 'aboutImage',
    alt: 'aboutImageAlt',
  },
];

function renderSlots() {
  for (const { slot, label, key, hint } of SLOTS) {
    const image = content[key];
    const box = $(`#slot-${slot}`);
    const input = el('input', 'visually-hidden');
    input.type = 'file';
    input.id = `slot-${slot}-file`;
    input.accept = 'image/jpeg,image/png,image/webp';
    input.addEventListener('change', () => uploadSlot(slot, input));

    const chooser = el(
      'label',
      'btn btn-outline-primary btn-sm me-2',
      image ? `Replace ${label.toLowerCase()}` : `Add ${label.toLowerCase()}`,
    );
    chooser.htmlFor = input.id;

    const parts = [el('div', 'form-label fw-semibold', label)];
    if (image) {
      const img = el('img', 'img-fluid rounded mb-2');
      img.src = image.thumb.url;
      img.alt = image.altText || label;
      img.width = 480;
      img.height = Math.round((480 * image.height) / image.width);
      parts.push(img);
      const alt = el('input', 'form-control form-control-sm mb-2');
      alt.id = `slot-${slot}-alt`;
      alt.maxLength = 250;
      alt.value = image.altText ?? '';
      alt.setAttribute(
        'aria-label',
        `Describe the ${label.toLowerCase()} for people who can't see it`,
      );
      alt.placeholder = 'Describe the photo (shown to screen readers)';
      parts.push(alt);
      const err = el('div', 'invalid-feedback');
      err.id = `slot-${slot}-alt-error`;
      parts.push(err);
    } else {
      parts.push(
        el(
          'div',
          'border rounded text-secondary p-4 mb-2 text-center',
          'No photo yet',
        ),
      );
    }
    const buttons = el('div');
    buttons.append(chooser, input);
    if (image) {
      buttons.append(
        iconButton(
          'bi-trash',
          `Remove the ${label.toLowerCase()}`,
          () =>
            confirmDelete(
              'Remove this photo?',
              'The photo is deleted from your website and from storage.',
              () => removeSlot(slot),
            ),
          'btn btn-outline-danger btn-sm',
        ),
      );
    }
    parts.push(buttons);
    parts.push(
      el(
        'div',
        'form-text',
        'JPEG, PNG or WebP, up to 15 MB. Location and camera details are removed automatically.',
      ),
    );
    if (hint) parts.push(el('div', 'form-text mt-1', hint));
    box.replaceChildren(...parts);
  }
}

async function uploadSlot(slot, input) {
  const file = input.files?.[0];
  if (!file) return;
  const body = new FormData();
  body.append('file', file);
  const alt = $(`#slot-${slot}-alt`)?.value.trim();
  if (alt) body.append('altText', alt);
  say('info', 'Uploading the photo…');
  const { ok, data } = await sendForm(
    'PUT',
    `/api/admin/site-content/images/${slot}`,
    body,
  );
  if (ok) {
    content = data.content;
    renderAbout();
    say('success', 'The photo was saved.');
  } else {
    say(
      'danger',
      apiProblem(data, "The photo couldn't be uploaded. Please try again."),
    );
  }
  input.value = '';
}

async function removeSlot(slot) {
  const { ok, data } = await adminApi(
    'DELETE',
    `/api/admin/site-content/images/${slot}`,
  );
  if (!ok) {
    say('danger', apiProblem(data, "The photo couldn't be removed."));
    return;
  }
  const refreshed = await adminApi('GET', '/api/admin/site-content');
  content = refreshed.data.content;
  renderAbout();
  say('success', 'The photo was removed.');
}

function renderAbout() {
  $('#about-tagline').value = content.tagline ?? '';
  $('#about-text').value = content.aboutText;
  renderSlots();
}

$('#about-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  clearErrors($('#about-form'));
  const payload = {
    tagline: $('#about-tagline').value,
    aboutText: $('#about-text').value,
  };
  for (const { slot, key, alt } of SLOTS) {
    if (content[key]) payload[alt] = $(`#slot-${slot}-alt`).value;
  }
  const button = $('#about-save');
  button.disabled = true;
  const { ok, data } = await adminApi(
    'PATCH',
    '/api/admin/site-content',
    payload,
  );
  button.disabled = false;
  if (!ok) {
    showFieldErrors(data?.details, {
      tagline: 'about-tagline',
      aboutText: 'about-text',
      heroImageAlt: 'slot-hero-alt',
      aboutImageAlt: 'slot-about-alt',
      logoImageAlt: 'slot-logo-alt',
    });
    return;
  }
  content = data.content;
  renderAbout();
  say('success', 'Saved.');
});

// --- Contact and area --------------------------------------------------------

function renderContact() {
  const type = content.locationType ?? '';
  for (const radio of document.querySelectorAll(
    'input[name="location-type"]',
  )) {
    radio.checked = radio.value === type;
  }
  $('#c-locationText').value = content.locationText ?? '';
  $('#c-whatsappNumber').value = content.whatsappNumber ?? '';
  $('#c-instagramUrl').value = content.instagramUrl ?? '';
  $('#c-facebookUrl').value = content.facebookUrl ?? '';
  $('#c-tiktokUrl').value = content.tiktokUrl ?? '';
}

$('#contact-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  clearErrors($('#contact-form'));
  const type =
    document.querySelector('input[name="location-type"]:checked')?.value ?? '';
  const text = $('#c-locationText').value.trim();
  if (type && !text) {
    showFieldErrors(
      [
        {
          field: 'locationText',
          message: 'Enter the area you travel to, or your studio address.',
        },
      ],
      { locationText: 'c-locationText' },
    );
    return;
  }
  const payload = {
    locationType: type || null,
    locationText: type ? text : null,
    whatsappNumber: $('#c-whatsappNumber').value.trim() || null,
    instagramUrl: $('#c-instagramUrl').value.trim() || null,
    facebookUrl: $('#c-facebookUrl').value.trim() || null,
    tiktokUrl: $('#c-tiktokUrl').value.trim() || null,
  };
  const button = $('#contact-save');
  button.disabled = true;
  const { ok, data } = await adminApi(
    'PATCH',
    '/api/admin/site-content',
    payload,
  );
  button.disabled = false;
  if (!ok) {
    showFieldErrors(data?.details, {
      locationText: 'c-locationText',
      locationType: 'c-locationText',
      whatsappNumber: 'c-whatsappNumber',
      instagramUrl: 'c-instagramUrl',
      facebookUrl: 'c-facebookUrl',
      tiktokUrl: 'c-tiktokUrl',
    });
    return;
  }
  content = data.content;
  renderContact();
  say('success', 'Saved.');
});

// --- Gallery -----------------------------------------------------------------

const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
let chosen = [];

function updateUploadState() {
  $('#chosen-files').textContent =
    chosen.length === 0
      ? 'No photos chosen.'
      : `${chosen.length} photo${chosen.length === 1 ? '' : 's'} chosen.`;
  // Stays off until permission is confirmed (BR-16)
  $('#upload-button').disabled = chosen.length === 0 || !$('#consent').checked;
}

function chooseFiles(files) {
  chosen = [...files];
  $('#upload-results').replaceChildren();
  updateUploadState();
}

$('#gallery-files').addEventListener('change', (event) =>
  chooseFiles(event.target.files),
);
$('#consent').addEventListener('change', updateUploadState);
const zone = $('#drop-zone');
zone.addEventListener('dragover', (event) => {
  event.preventDefault();
  zone.classList.add('bg-light');
});
zone.addEventListener('dragleave', () => zone.classList.remove('bg-light'));
zone.addEventListener('drop', (event) => {
  event.preventDefault();
  zone.classList.remove('bg-light');
  if (event.dataTransfer?.files?.length) chooseFiles(event.dataTransfer.files);
});

function resultLine(name, ok, text) {
  const li = el('li', ok ? 'text-success' : 'text-danger');
  const mark = el('i', `bi ${ok ? 'bi-check-circle' : 'bi-x-circle'} me-1`);
  mark.setAttribute('aria-hidden', 'true');
  li.append(mark, document.createTextNode(`${name}: ${text}`));
  return li;
}

$('#upload-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!$('#consent').checked || chosen.length === 0) return;
  const button = $('#upload-button');
  button.disabled = true;
  const results = $('#upload-results');
  results.replaceChildren();

  // Photos the browser says are not images are left out here; the server
  // checks the real content of the rest
  const sendable = [];
  for (const file of chosen) {
    if (PHOTO_TYPES.includes(file.type)) sendable.push(file);
    else
      results.append(
        resultLine(file.name, false, 'Not a JPEG, PNG or WebP photo.'),
      );
  }

  const total = sendable.reduce((sum, file) => sum + file.size, 0) || 1;
  let done = 0;
  $('#upload-progress').hidden = false;
  const setProgress = (bytes) => {
    const percent = Math.min(100, Math.round((bytes / total) * 100));
    $('#upload-bar').style.width = `${percent}%`;
    $('#upload-progress').setAttribute('aria-valuenow', String(percent));
  };
  setProgress(0);

  let added = 0;
  for (let i = 0; i < sendable.length; i += 10) {
    const batch = sendable.slice(i, i + 10);
    const body = new FormData();
    body.append('consent', 'true');
    if ($('#upload-service').value)
      body.append('serviceId', $('#upload-service').value);
    for (const file of batch) body.append('files', file);
    const batchBytes = batch.reduce((sum, file) => sum + file.size, 0);
    const { ok, data } = await sendForm(
      'POST',
      '/api/admin/gallery',
      body,
      (loaded, all) => setProgress(done + (loaded / all) * batchBytes),
    );
    done += batchBytes;
    if (ok) {
      for (const result of data.results) {
        if (result.status === 'created') {
          added += 1;
          results.append(resultLine(result.filename, true, 'added'));
        } else {
          results.append(
            resultLine(result.filename, false, result.error.message),
          );
        }
      }
    } else {
      for (const file of batch) {
        results.append(
          resultLine(
            file.name,
            false,
            apiProblem(data, "couldn't be uploaded."),
          ),
        );
      }
      break; // a request-level problem (permission, full, too many) stops the rest
    }
  }
  setProgress(total);
  $('#upload-progress').hidden = true;
  chosen = [];
  $('#gallery-files').value = '';
  // Each batch of photos needs its own confirmation of permission (BR-16)
  $('#consent').checked = false;
  updateUploadState();
  button.disabled = true;
  await loadGallery();
  if (added > 0)
    say(
      'success',
      `${added} photo${added === 1 ? '' : 's'} added to your gallery.`,
    );
});

async function loadGallery() {
  const { ok, data } = await adminApi('GET', '/api/admin/gallery');
  if (!ok) {
    say('danger', "The gallery couldn't be loaded.");
    return;
  }
  galleryItems = data.items;
  renderGallery(data.count, data.limit);
}

async function patchItem(item, change) {
  const { ok, data } = await adminApi(
    'PATCH',
    `/api/admin/gallery/${item.id}`,
    change,
  );
  if (!ok) {
    say('danger', apiProblem(data, "That change couldn't be saved."));
    await loadGallery(); // show what is really saved
    return;
  }
  Object.assign(item, data.item);
  say('success', 'Saved.');
}

async function saveOrder(ids) {
  const { ok, data } = await adminApi('PUT', '/api/admin/gallery/order', {
    ids,
  });
  if (!ok) {
    say('danger', apiProblem(data, "The order couldn't be saved."));
    return;
  }
  galleryItems = data.items;
  renderGallery(galleryItems.length, 200);
  say('success', 'Saved.');
}

function galleryCard(item) {
  const column = el('div', 'col-sm-6 col-lg-4 col-xl-3');
  column.dataset.id = item.id;
  column.classList.add('mbg-gallery-card');
  const card = el('div', `card h-100${item.isVisible ? '' : ' opacity-75'}`);

  const img = el('img', 'card-img-top');
  img.src = item.image.thumb.url;
  img.alt = item.image.altText || item.caption || 'Gallery photo';
  img.loading = 'lazy';
  img.width = 480;
  img.height = Math.round((480 * item.image.height) / item.image.width);
  card.append(img);

  const body = el('div', 'card-body p-2');
  const caption = el('input', 'form-control form-control-sm mb-1');
  caption.value = item.caption ?? '';
  caption.maxLength = 200;
  caption.placeholder = 'Caption';
  caption.setAttribute('aria-label', 'Caption');
  caption.addEventListener('change', () =>
    patchItem(item, { caption: caption.value.trim() || null }),
  );

  const service = el('select', 'form-select form-select-sm mb-1');
  service.setAttribute('aria-label', 'Service');
  serviceOptions(service, item.service?.id ?? null, 'No service');
  service.addEventListener('change', () =>
    patchItem(item, { serviceId: service.value || null }),
  );

  const details = el('details', 'mb-1');
  details.append(el('summary', 'small', 'Description for screen readers'));
  const alt = el('input', 'form-control form-control-sm mt-1');
  alt.value = item.image.altText ?? '';
  alt.maxLength = 250;
  alt.setAttribute('aria-label', 'Description for screen readers');
  alt.placeholder = 'Defaults to the caption';
  alt.addEventListener('change', () =>
    patchItem(item, { altText: alt.value.trim() || null }),
  );
  details.append(alt);

  const row = el('div', 'd-flex justify-content-between align-items-center');
  const toggle = el('div', 'form-check form-switch mb-0');
  const box = el('input', 'form-check-input');
  box.type = 'checkbox';
  box.id = `visible-${item.id}`;
  box.checked = item.isVisible;
  const label = el(
    'label',
    'form-check-label',
    item.isVisible ? 'Shown' : 'Hidden',
  );
  label.htmlFor = box.id;
  box.addEventListener('change', async () => {
    label.textContent = box.checked ? 'Shown' : 'Hidden';
    await patchItem(item, { isVisible: box.checked });
    card.classList.toggle('opacity-75', !box.checked);
  });
  toggle.append(box, label);

  const ids = galleryItems.map((g) => g.id);
  const actions = el('div', 'd-flex gap-1');
  actions.append(
    iconButton('bi-arrow-left', 'Move earlier', () => {
      const next = moved(ids, item.id, -1);
      if (next) saveOrder(next);
    }),
    iconButton('bi-arrow-right', 'Move later', () => {
      const next = moved(ids, item.id, 1);
      if (next) saveOrder(next);
    }),
    iconButton(
      'bi-trash',
      'Delete this photo',
      () =>
        confirmDelete(
          'Delete this photo?',
          "The photo is removed from your gallery and deleted from storage. This can't be undone.",
          async () => {
            const { ok, data } = await adminApi(
              'DELETE',
              `/api/admin/gallery/${item.id}`,
            );
            if (!ok)
              return say(
                'danger',
                apiProblem(data, "The photo couldn't be deleted."),
              );
            await loadGallery();
            say('success', 'The photo was deleted.');
          },
        ),
      'btn btn-outline-danger btn-sm',
    ),
  );
  row.append(toggle, actions);
  body.append(caption, service, details, row);
  card.append(body);
  column.append(card);
  return column;
}

function renderGallery(count, limit) {
  const box = $('#gallery-items');
  box.replaceChildren(...galleryItems.map(galleryCard));
  $('#gallery-empty').hidden = galleryItems.length > 0;
  $('#gallery-count').textContent =
    galleryItems.length === 0 ? '' : `${count} of ${limit} photos used.`;
  dragReorder(box, '.mbg-gallery-card', saveOrder);
}

// --- Testimonials and FAQ ----------------------------------------------------

// Both lists work the same way: a form to add or edit, and a list with edit,
// show or hide, move and delete. `config` says what differs.
function manageList(config) {
  let items = [];
  let editing = null; // the item being edited, or null when adding
  const form = $(config.form);
  const list = $(config.list);

  const readForm = () => config.read();
  const reset = () => {
    editing = null;
    config.fill(null);
    $(config.title).textContent = config.addTitle;
    $(config.save).textContent = config.addLabel;
    $(config.cancel).hidden = true;
    clearErrors(form);
  };

  function render() {
    $(config.empty).hidden = items.length > 0;
    list.replaceChildren(
      ...items.map((item) => {
        const li = el(
          'li',
          `list-group-item d-flex gap-2 align-items-start${item.isVisible ? '' : ' text-secondary'}`,
        );
        li.dataset.id = item.id;
        const grip = el('i', 'bi bi-grip-vertical mt-1');
        grip.setAttribute('aria-hidden', 'true');
        const text = el('div', 'flex-grow-1');
        for (const [index, line] of config.lines(item).entries()) {
          text.append(
            el('div', index === 0 ? '' : 'small text-secondary', line),
          );
        }
        const ids = items.map((i) => i.id);
        const actions = el('div', 'd-flex flex-wrap gap-1');
        actions.append(
          iconButton('bi-pencil', 'Edit', () => {
            editing = item;
            config.fill(item);
            $(config.title).textContent = config.editTitle;
            $(config.save).textContent = 'Save changes';
            $(config.cancel).hidden = false;
            form.scrollIntoView({ block: 'nearest' });
          }),
          iconButton(
            item.isVisible ? 'bi-eye-slash' : 'bi-eye',
            item.isVisible
              ? 'Hide from the home page'
              : 'Show on the home page',
            async () => {
              const { ok, data } = await adminApi(
                'PATCH',
                `${config.path}/${item.id}`,
                { isVisible: !item.isVisible },
              );
              if (!ok)
                return say(
                  'danger',
                  apiProblem(data, "That change couldn't be saved."),
                );
              await load();
              say('success', 'Saved.');
            },
          ),
          iconButton('bi-arrow-up', 'Move up', () => {
            const next = moved(ids, item.id, -1);
            if (next) reorder(next);
          }),
          iconButton('bi-arrow-down', 'Move down', () => {
            const next = moved(ids, item.id, 1);
            if (next) reorder(next);
          }),
          iconButton(
            'bi-trash',
            'Delete',
            () =>
              confirmDelete(config.deleteTitle, config.deleteText, async () => {
                const { ok, data } = await adminApi(
                  'DELETE',
                  `${config.path}/${item.id}`,
                );
                if (!ok)
                  return say(
                    'danger',
                    apiProblem(data, "That couldn't be deleted."),
                  );
                if (editing?.id === item.id) reset();
                await load();
                say('success', 'Deleted.');
              }),
            'btn btn-outline-danger btn-sm',
          ),
        );
        li.append(grip, text, actions);
        return li;
      }),
    );
    dragReorder(list, '.list-group-item', reorder);
  }

  async function reorder(ids) {
    const { ok, data } = await adminApi('PUT', `${config.path}/order`, { ids });
    if (!ok)
      return say('danger', apiProblem(data, "The order couldn't be saved."));
    items = data.items;
    render();
    say('success', 'Saved.');
  }

  async function load() {
    const { ok, data } = await adminApi('GET', config.path);
    if (!ok) return say('danger', "The list couldn't be loaded.");
    items = data.items;
    render();
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors(form);
    const button = $(config.save);
    button.disabled = true;
    const payload = readForm();
    const { ok, data } = editing
      ? await adminApi('PATCH', `${config.path}/${editing.id}`, payload)
      : await adminApi('POST', config.path, payload);
    button.disabled = false;
    if (!ok) {
      showFieldErrors(data?.details, config.ids);
      return;
    }
    reset();
    await load();
    say('success', 'Saved.');
  });
  $(config.cancel).addEventListener('click', reset);

  return { load, reset };
}

const testimonials = manageList({
  path: '/api/admin/testimonials',
  form: '#testimonial-form',
  list: '#t-list',
  empty: '#t-empty',
  title: '#testimonial-form-title',
  save: '#t-save',
  cancel: '#t-cancel',
  addTitle: 'Add a testimonial',
  editTitle: 'Edit this testimonial',
  addLabel: 'Add testimonial',
  deleteTitle: 'Delete this testimonial?',
  deleteText: "It's removed from your home page for good.",
  ids: {
    clientName: 't-clientName',
    quote: 't-quote',
    serviceId: 't-serviceId',
  },
  read: () => ({
    clientName: $('#t-clientName').value,
    quote: $('#t-quote').value,
    serviceId: $('#t-serviceId').value || null,
    isVisible: $('#t-isVisible').checked,
  }),
  fill: (item) => {
    $('#t-clientName').value = item?.clientName ?? '';
    $('#t-quote').value = item?.quote ?? '';
    serviceOptions($('#t-serviceId'), item?.service?.id ?? null, 'No service');
    $('#t-isVisible').checked = item ? item.isVisible : true;
  },
  lines: (item) => [
    `"${item.quote}"`,
    [item.clientName, item.service?.name, item.isVisible ? 'Shown' : 'Hidden']
      .filter(Boolean)
      .join(' · '),
  ],
});

const faqs = manageList({
  path: '/api/admin/faqs',
  form: '#faq-form',
  list: '#f-list',
  empty: '#f-empty',
  title: '#faq-form-title',
  save: '#f-save',
  cancel: '#f-cancel',
  addTitle: 'Add a question',
  editTitle: 'Edit this question',
  addLabel: 'Add question',
  deleteTitle: 'Delete this question?',
  deleteText: "It's removed from your home page for good.",
  ids: { question: 'f-question', answer: 'f-answer' },
  read: () => ({
    question: $('#f-question').value,
    answer: $('#f-answer').value,
    isVisible: $('#f-isVisible').checked,
  }),
  fill: (item) => {
    $('#f-question').value = item?.question ?? '';
    $('#f-answer').value = item?.answer ?? '';
    $('#f-isVisible').checked = item ? item.isVisible : true;
  },
  lines: (item) => [
    item.question,
    `${item.answer.length > 90 ? `${item.answer.slice(0, 90)}…` : item.answer} · ${item.isVisible ? 'Shown' : 'Hidden'}`,
  ],
});

// --- Loading -----------------------------------------------------------------

async function load() {
  const [site, serviceList] = await Promise.all([
    adminApi('GET', '/api/admin/site-content'),
    adminApi('GET', '/api/admin/services'),
  ]);
  $('#loading').hidden = true;
  if (!site.ok) {
    say(
      'danger',
      "The website settings couldn't be loaded. Please refresh the page.",
    );
    return;
  }
  content = site.data.content;
  services = serviceList.ok ? serviceList.data.services : [];

  renderAbout();
  renderContact();
  serviceOptions($('#upload-service'), null, 'No service');
  testimonials.reset();
  faqs.reset();
  await Promise.all([loadGallery(), testimonials.load(), faqs.load()]);
  updateUploadState();
  $('#tabs').hidden = false;
}

load();
