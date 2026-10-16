// The home page (C-1, C-9, #105): built from GET /api/site and GET
// /api/services. Every piece of text goes in as text, never as HTML, so
// nothing the owner types can change the page. A section with nothing in it
// stays hidden.
import { el, formatDuration, formatRand } from '/js/format.js';
import { groupHours, hasWorkingDays } from '/js/hours.js';

const $ = (selector) => document.querySelector(selector);

const GALLERY_PAGE = 8; // photos shown at first, and added by each "Show more"

let site = null;
let services = [];
let filter = 'all'; // 'all' or a service id
let shown = GALLERY_PAGE;
let lightboxItems = [];
let lightboxIndex = 0;

// "+27821234567" becomes "082 123 4567", how people write a South African number
function localNumber(number) {
  const match = /^\+27(\d{2})(\d{3})(\d{4})$/.exec(number);
  return match ? `0${match[1]} ${match[2]} ${match[3]}` : number;
}

// --- Pieces ------------------------------------------------------------------

function image(photo, className, options = {}) {
  const img = el('img', className);
  img.src = photo.url;
  img.alt = options.alt ?? '';
  img.width = photo.width;
  img.height = photo.height;
  img.loading = options.eager ? 'eager' : 'lazy';
  img.decoding = 'async';
  return img;
}

function icon(name) {
  const mark = el('i', `bi ${name} me-2`);
  mark.setAttribute('aria-hidden', 'true');
  return mark;
}

// --- Hero --------------------------------------------------------------------

function renderHero({ business, content }) {
  $('#hero-title').textContent = business.name;
  if (content.tagline) $('#hero-tagline').textContent = content.tagline;
  // The logo, when the owner has uploaded one (brand.js draws it); the
  // business name is the heading either way
  $('#hero-logo').hidden = !content.logoImage;
  window.mbgSetTitle?.(
    content.tagline ? `${business.name} · ${content.tagline}` : 'Home',
  );

  if (content.heroImage) {
    const box = $('#hero-photo');
    box.replaceChildren(
      image(content.heroImage.large, 'mbg-hero-photo', {
        alt: content.heroImage.alt,
        eager: true,
      }),
    );
    box.hidden = false;
    // The text sits over the photo, so the logo (a second picture) is left out
    $('#hero').classList.add('mbg-hero-with-photo');
    $('#hero-logo').hidden = true;
  }
}

// --- About -------------------------------------------------------------------

function renderAbout({ business, content }) {
  if (content.about.length === 0) return;
  $('#h-about').textContent = `About ${business.name}`;
  $('#about-paragraphs').replaceChildren(
    ...content.about.map((paragraph) => el('p', '', paragraph)),
  );
  if (content.aboutImage) {
    const box = $('#about-photo');
    box.replaceChildren(
      image(content.aboutImage.large, 'img-fluid rounded mbg-about-photo', {
        alt: content.aboutImage.alt,
      }),
    );
    box.hidden = false;
  }
  $('#about').hidden = false;
}

// --- Services ----------------------------------------------------------------

function servicePhoto(serviceId) {
  return site.gallery.find((item) => item.service?.id === serviceId) ?? null;
}

function serviceCard(service, depositApplies) {
  const column = el('div', 'col-12 col-md-6 col-lg-4');
  const card = el('article', 'card mbg-card-raised h-100');
  // The owner's own picture for the service comes first; a gallery photo
  // tagged with the service is the fallback
  const galleryPhoto = servicePhoto(service.id);
  const photo = service.image ?? galleryPhoto;
  if (photo) {
    card.append(
      image(photo.thumb, 'card-img-top mbg-service-photo', { alt: photo.alt }),
    );
  }
  const body = el('div', 'card-body d-flex flex-column');
  body.append(el('h3', 'h4 text-body mb-2', service.name));
  if (service.description) {
    body.append(el('p', 'text-secondary mb-3', service.description));
  }
  if (service.availableForTravel) {
    const where = el('p', 'small text-secondary mb-2');
    where.append(
      icon('bi-house-check'),
      document.createTextNode(
        service.availableAtOurPlace
          ? 'At our place or yours'
          : 'We come to you',
      ),
    );
    body.append(where);
  }
  const facts = el('p', 'mb-3 mt-auto');
  facts.append(
    icon('bi-clock'),
    document.createTextNode(`${formatDuration(service.durationMinutes)} · `),
    el('strong', 'mbg-price', formatRand(service.price)),
  );
  if (depositApplies) {
    facts.append(
      document.createTextNode(
        ` · Deposit ${formatRand(service.depositAmount)}`,
      ),
    );
  }
  body.append(facts);

  const buttons = el('div', 'd-flex flex-wrap gap-2');
  const book = el('a', 'btn btn-book', 'Book');
  book.href = `/book.html?service=${encodeURIComponent(service.id)}`;
  buttons.append(book);
  if (galleryPhoto) {
    const see = el('a', 'btn btn-outline-primary', 'See photos');
    see.href = '#gallery';
    see.addEventListener('click', () => chooseFilter(service.id));
    buttons.append(see);
  }
  body.append(buttons);
  card.append(body);
  column.append(card);
  return column;
}

function renderServices(depositApplies) {
  if (services.length === 0) return;
  $('#services-list').replaceChildren(
    ...services.map((service) => serviceCard(service, depositApplies)),
  );
  $('#services').hidden = false;
}

// --- Gallery -----------------------------------------------------------------

// Services that have at least one photo, in the order they first appear
function servicesWithPhotos() {
  const seen = new Map();
  for (const item of site.gallery) {
    if (item.service && !seen.has(item.service.id)) {
      seen.set(item.service.id, item.service.name);
    }
  }
  return [...seen].map(([id, name]) => ({ id, name }));
}

function visibleItems() {
  return filter === 'all'
    ? site.gallery
    : site.gallery.filter((item) => item.service?.id === filter);
}

function chooseFilter(next) {
  filter = next;
  shown = GALLERY_PAGE;
  renderFilters();
  renderGrid();
}

function renderFilters() {
  const options = [{ id: 'all', name: 'All' }, ...servicesWithPhotos()];
  const box = $('#gallery-filters');
  // Filters only make sense when photos are tagged with more than one thing
  box.hidden = options.length < 3;
  box.replaceChildren(
    ...options.map(({ id, name }) => {
      const chip = el(
        'button',
        `mbg-chip${id === filter ? ' is-active' : ''}`,
        name,
      );
      chip.type = 'button';
      chip.setAttribute('aria-pressed', String(id === filter));
      chip.addEventListener('click', () => chooseFilter(id));
      return chip;
    }),
  );
}

function renderGrid() {
  const items = visibleItems();
  $('#gallery-grid').replaceChildren(
    ...items.slice(0, shown).map((item, index) => {
      const column = el('div', 'col-6 col-md-3');
      const button = el('button', 'mbg-gallery-tile');
      button.type = 'button';
      button.setAttribute('aria-label', `Open photo: ${item.alt}`);
      button.append(image(item.thumb, 'mbg-gallery-photo', { alt: item.alt }));
      button.addEventListener('click', () => openLightbox(index));
      column.append(button);
      return column;
    }),
  );
  $('#gallery-more').hidden = items.length <= shown;
}

function renderGallery() {
  if (site.gallery.length === 0) return;
  renderFilters();
  renderGrid();
  $('#gallery').hidden = false;
}

$('#gallery-more').addEventListener('click', () => {
  shown += GALLERY_PAGE;
  renderGrid();
});

// --- Lightbox ----------------------------------------------------------------

let lightboxModal = null;

function showLightboxPhoto() {
  const item = lightboxItems[lightboxIndex];
  const img = $('#lightbox-image');
  img.src = item.large.url;
  img.alt = item.alt;
  img.width = item.large.width;
  img.height = item.large.height;
  $('#lightbox-title').textContent = item.service?.name ?? 'Photo';
  $('#lightbox-caption').textContent = item.caption ?? '';
  $('#lightbox-count').textContent =
    `${lightboxIndex + 1} of ${lightboxItems.length}`;
  $('#lightbox-prev').disabled = lightboxItems.length < 2;
  $('#lightbox-next').disabled = lightboxItems.length < 2;
}

function step(by) {
  if (lightboxItems.length < 2) return;
  lightboxIndex =
    (lightboxIndex + by + lightboxItems.length) % lightboxItems.length;
  showLightboxPhoto();
}

function openLightbox(index) {
  lightboxItems = visibleItems();
  lightboxIndex = index;
  showLightboxPhoto();
  lightboxModal ??= new bootstrap.Modal('#lightbox');
  lightboxModal.show();
}

$('#lightbox-prev').addEventListener('click', () => step(-1));
$('#lightbox-next').addEventListener('click', () => step(1));
$('#lightbox').addEventListener('keydown', (event) => {
  if (event.key === 'ArrowLeft') step(-1);
  if (event.key === 'ArrowRight') step(1);
});
// Swipe on a phone
let touchStart = null;
$('#lightbox').addEventListener('touchstart', (event) => {
  touchStart = event.changedTouches[0].clientX;
});
$('#lightbox').addEventListener('touchend', (event) => {
  if (touchStart === null) return;
  const distance = event.changedTouches[0].clientX - touchStart;
  touchStart = null;
  if (Math.abs(distance) > 50) step(distance < 0 ? 1 : -1);
});

// --- Testimonials, policies and questions ------------------------------------

function renderTestimonials() {
  if (site.testimonials.length === 0) return;
  $('#testimonials-list').replaceChildren(
    ...site.testimonials.map((t) => {
      const column = el('div', 'col-md-4');
      const card = el('figure', 'card card-body h-100 mb-0');
      card.append(el('blockquote', 'mb-3', `"${t.quote}"`));
      card.append(
        el(
          'figcaption',
          'small text-secondary',
          t.service ? `${t.clientName} · ${t.service.name}` : t.clientName,
        ),
      );
      column.append(card);
      return column;
    }),
  );
  $('#testimonials').hidden = false;
}

function renderPolicies() {
  const { policies, faqs } = site;
  if (policies.text.length === 0 && faqs.length === 0) return;
  $('#policies-list').replaceChildren(
    ...policies.text.map((line) => el('li', 'mb-2', line)),
  );
  if (faqs.length > 0) {
    $('#faq').replaceChildren(
      ...faqs.map((faq, index) => {
        const id = `faq-${index}`;
        const item = el('div', 'accordion-item');
        const header = el('h4', 'accordion-header');
        const button = el('button', 'accordion-button collapsed', faq.question);
        button.type = 'button';
        button.dataset.bsToggle = 'collapse';
        button.dataset.bsTarget = `#${id}`;
        button.setAttribute('aria-expanded', 'false');
        button.setAttribute('aria-controls', id);
        header.append(button);
        const panel = el('div', 'accordion-collapse collapse');
        panel.id = id;
        panel.dataset.bsParent = '#faq';
        panel.append(el('div', 'accordion-body', faq.answer));
        item.append(header, panel);
        return item;
      }),
    );
    $('#faq-block').hidden = false;
  }
  $('#policies').hidden = false;
}

// --- Hours, area and contact -------------------------------------------------

function renderContact({ business, content, workingHours }) {
  if (hasWorkingDays(workingHours.days)) {
    $('#hours-rows').replaceChildren(
      ...groupHours(workingHours.days).map(({ label, hours }) => {
        const row = el('tr');
        row.append(el('td', '', label), el('td', '', hours));
        return row;
      }),
    );
    $('#hours-block').hidden = false;
  }

  if (content.location) {
    $('#where-text').replaceChildren(
      icon('bi-house-check'),
      document.createTextNode(
        content.location.type === 'travel'
          ? `I travel to you in ${content.location.text}.`
          : content.location.text,
      ),
    );
    $('#where-block').hidden = false;
  }

  const links = [];
  const add = (iconName, label, href) => {
    const item = el('li', 'mb-2');
    const a = el('a', '', label);
    a.href = href;
    if (href.startsWith('https://')) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
    item.append(icon(iconName), a);
    links.push(item);
  };
  const { social } = content;
  if (social.whatsapp) {
    add(
      'bi-whatsapp',
      `WhatsApp ${localNumber(social.whatsapp.number)}`,
      social.whatsapp.url,
    );
  }
  if (social.instagram) add('bi-instagram', 'Instagram', social.instagram);
  if (social.facebook) add('bi-facebook', 'Facebook', social.facebook);
  if (social.tiktok) add('bi-tiktok', 'TikTok', social.tiktok);
  add('bi-envelope', business.email, `mailto:${business.email}`);
  if (business.phone && !social.whatsapp) {
    add('bi-telephone', business.phone, `tel:${business.phone}`);
  }
  $('#contact-links').replaceChildren(...links);
}

// --- Loading -----------------------------------------------------------------

async function load() {
  let siteData;
  let serviceData;
  try {
    const [siteRes, serviceRes] = await Promise.all([
      fetch('/api/site'),
      fetch('/api/services'),
    ]);
    if (!siteRes.ok) throw new Error(`site ${siteRes.status}`);
    siteData = await siteRes.json();
    // The services list is optional: the rest of the page works without it
    serviceData = serviceRes.ok ? await serviceRes.json() : null;
  } catch {
    // The static hero is still there with its Book now button
    return;
  }
  site = siteData;
  services = serviceData?.services ?? [];

  renderHero(site);
  renderAbout(site);
  renderServices(Number(serviceData?.depositPercent ?? 0) > 0);
  renderGallery();
  renderTestimonials();
  renderPolicies();
  renderContact(site);
}

load();
