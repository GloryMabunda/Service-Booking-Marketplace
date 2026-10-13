// The public service list (C-1, #32): loads GET /api/services and shows each
// active service with its duration, price and deposit.
import { el, formatDuration, formatRand } from '/js/format.js';

// The Book button opens the date and time picker (#40). The step after it,
// entering your details, arrives in M4 (#51).
const BOOKING_OPEN = true;

const loading = document.querySelector('#services-loading');
const errorBox = document.querySelector('#services-error');
const emptyBox = document.querySelector('#services-empty');
const list = document.querySelector('#services-list');

function serviceCard(service, depositApplies) {
  const column = el('div', 'col-12 col-md-6');
  const card = el('article', 'card mbg-card-raised h-100');
  const body = el('div', 'card-body d-flex flex-column');

  body.append(el('h2', 'h3 text-body mb-2', service.name));
  if (service.description) {
    body.append(el('p', 'text-secondary mb-3', service.description));
  }

  const facts = el('p', 'mb-3 mt-auto');
  facts.append(
    el('i', 'bi bi-clock me-1'),
    document.createTextNode(`${formatDuration(service.durationMinutes)} · `),
    el('strong', 'mbg-price', formatRand(service.price)),
  );
  facts.firstChild.setAttribute('aria-hidden', 'true');
  if (depositApplies) {
    facts.append(
      document.createTextNode(
        ` · Deposit ${formatRand(service.depositAmount)}`,
      ),
    );
  }
  body.append(facts);

  if (BOOKING_OPEN) {
    const book = el('a', 'btn btn-book', 'Book');
    book.href = `/book.html?service=${encodeURIComponent(service.id)}`;
    body.append(book);
  } else {
    const soon = el('button', 'btn btn-outline-primary', 'Booking opens soon');
    soon.type = 'button';
    soon.disabled = true;
    body.append(soon);
  }

  card.append(body);
  column.append(card);
  return column;
}

function showBusiness(business) {
  document.querySelector('#business-name').textContent = business.name;
  const email = document.querySelector('#business-email');
  email.textContent = business.email;
  email.href = `mailto:${business.email}`;
  if (business.phone) {
    const phone = document.querySelector('#business-phone');
    phone.textContent = business.phone;
    phone.href = `tel:${business.phone}`;
    document.querySelector('#business-phone-row').hidden = false;
  }
  document.querySelector('#business-info').hidden = false;
}

async function load() {
  try {
    const res = await fetch('/api/services');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const depositApplies = Number(data.depositPercent) > 0;

    showBusiness(data.business);

    if (data.services.length === 0) {
      document.querySelector('#services-empty-text').textContent =
        "Bookings aren't open right now. Please contact us for availability.";
      emptyBox.classList.remove('d-none');
      emptyBox.classList.add('d-flex');
      return;
    }

    if (depositApplies) {
      const note = document.querySelector('#deposit-note');
      note.textContent = `A ${Number(data.depositPercent)}% deposit secures your booking. You'll get payment instructions by email after booking.`;
      note.hidden = false;
    }
    list.replaceChildren(
      ...data.services.map((s) => serviceCard(s, depositApplies)),
    );
  } catch {
    errorBox.classList.remove('d-none');
    errorBox.classList.add('d-flex');
  } finally {
    loading.hidden = true;
  }
}

load();
