// The date and time picker (C-2, #40): step 1 of booking.
//
//   /book.html?service=<id>
//
// Dates come from GET /api/services (bookingWindow: the first and last date
// that can be booked, so days that are too soon because of the minimum notice
// and the payment window are greyed out). Times come from GET /api/availability
// for the chosen day, in the business time zone.
import { el, formatDuration, formatRand } from '/js/format.js';
import { formatDay, isoDayOfWeek, zoneShortName } from '/js/time-zone.js';

// The next step is the details page (#51).
const NEXT_STEP_READY = true;

const $ = (selector) => document.querySelector(selector);
const pageLoading = $('#page-loading');
const picker = $('#picker');
const calendar = $('#calendar');
const slotsBox = $('#slots');
const continueButton = $('#continue');

let service = null;
let bookingWindow = null; // the booking window from the API
let depositPercent = 0;
let travel = null; // the travel fee rules, or null when travel isn't offered
let place = 'studio'; // 'studio' (our place) or 'client' (their place)
let visibleMonth = null; // { year, month } with month 1 to 12
let selectedDate = null;
let selectedSlot = null; // { startAt, localTime }
let slotRequest = 0; // ignores answers for a date the client has left

function showPageError(text) {
  pageLoading.hidden = true;
  $('#page-error-text').textContent = text;
  $('#page-error').classList.remove('d-none');
  $('#page-error').classList.add('d-flex');
}

// --- Loading the service and the booking window ---------------------------

async function load() {
  const serviceId = new URLSearchParams(location.search).get('service');
  try {
    const res = await fetch('/api/services');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    service = data.services.find((s) => s.id === serviceId);
    if (!service) {
      showPageError(
        "That service isn't available. Please choose a service from the list.",
      );
      return;
    }
    bookingWindow = data.bookingWindow;
    depositPercent = Number(data.depositPercent);
    travel = data.travel;
  } catch {
    showPageError("We couldn't load this page. Please refresh and try again.");
    return;
  }

  $('#service-name').textContent = service.name;
  const facts = [
    formatDuration(service.durationMinutes),
    formatRand(service.price),
  ];
  if (depositPercent > 0)
    facts.push(`Deposit ${formatRand(service.depositAmount)}`);
  $('#service-facts').textContent = facts.join(' · ');

  // A service done only at the client's place needs the owner's travel set up
  if (
    !service.availableAtOurPlace &&
    (!travel || !service.availableForTravel)
  ) {
    showPageError(
      "This service is done at your place, and booking it online isn't set up yet. Please contact us to book.",
    );
    return;
  }
  setupLocationChoice();

  const [year, month] = bookingWindow.firstDate.split('-').map(Number);
  visibleMonth = { year, month };
  renderCalendar();
  pageLoading.hidden = true;
  picker.hidden = false;
}

// --- Where the appointment is (#115) ---------------------------------------

// Shown only when the owner travels and this service can be done at the
// client's place. The fee is explained here and worked out exactly, from their
// address, on the next page.
function setupLocationChoice() {
  if (!travel || !service.availableForTravel) return;
  const rate = formatRand(travel.ratePerKm);
  const parts = [`a call-out fee of ${formatRand(travel.callOutFee)}`];
  if (Number(travel.ratePerKm) > 0) {
    parts.push(
      `${rate} per km${travel.chargeReturn ? ' for the trip there and back' : ''}${travel.freeKm > 0 ? ` after the first ${travel.freeKm} km` : ''}`,
    );
  }
  $('#travel-explanation').textContent =
    `If we come to you, a travel fee applies: ${parts.join(' plus ')}. It is paid with your deposit. We travel up to ${travel.maxKm} km, and you'll see the exact fee before you book.`;
  $('#location-choice').hidden = false;
  if (!service.availableAtOurPlace) {
    // Only the client's place: nothing to choose, just say how it works
    place = 'client';
    for (const box of document.querySelectorAll(
      '#location-choice .form-check',
    )) {
      box.hidden = true;
    }
    $('#location-choice legend').textContent = 'We come to you';
    $('#travel-explanation').textContent =
      `This service is done at your place. A travel fee applies: ${parts.join(' plus ')}. It is paid with your deposit. We travel up to ${travel.maxKm} km, and you'll see the exact fee before you book.`;
    return;
  }
  for (const radio of document.querySelectorAll('input[name="location"]')) {
    radio.addEventListener('change', () => {
      place = radio.value;
      // Travel time is blocked around the appointment, so the open times differ
      if (selectedDate) chooseDate(selectedDate);
      else resetSlots();
    });
  }
}

// --- The calendar ----------------------------------------------------------

const pad = (n) => String(n).padStart(2, '0');
const monthKey = ({ year, month }) => year * 12 + month;
const dateMonth = (date) => {
  const [year, month] = date.split('-').map(Number);
  return { year, month };
};

function renderCalendar() {
  const { year, month } = visibleMonth;
  $('#month-label').textContent = formatDay(`${year}-${pad(month)}-01`, {
    month: 'long',
    year: 'numeric',
  });
  $('#prev-month').disabled =
    monthKey(visibleMonth) <= monthKey(dateMonth(bookingWindow.firstDate));
  $('#next-month').disabled =
    monthKey(visibleMonth) >= monthKey(dateMonth(bookingWindow.lastDate));

  const cells = [];
  // Monday-first week header (the same numbering the working hours use)
  for (const name of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) {
    const head = el('div', 'mbg-dow', name);
    head.setAttribute('aria-hidden', 'true');
    cells.push(head);
  }
  const first = `${year}-${pad(month)}-01`;
  for (let i = 1; i < isoDayOfWeek(first); i++) cells.push(el('div'));

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${year}-${pad(month)}-${pad(day)}`;
    const button = el('button', 'mbg-day', String(day));
    button.type = 'button';
    button.setAttribute('aria-label', formatDay(date));
    // Dates outside the booking window can't be picked (#40)
    button.disabled =
      date < bookingWindow.firstDate || date > bookingWindow.lastDate;
    const isSelected = date === selectedDate;
    button.classList.toggle('is-selected', isSelected);
    button.setAttribute('aria-pressed', String(isSelected));
    button.addEventListener('click', () => chooseDate(date));
    cells.push(button);
  }
  calendar.replaceChildren(...cells);
}

function changeMonth(step) {
  const next = new Date(
    Date.UTC(visibleMonth.year, visibleMonth.month - 1 + step, 1),
  );
  visibleMonth = { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1 };
  renderCalendar();
}
$('#prev-month').addEventListener('click', () => changeMonth(-1));
$('#next-month').addEventListener('click', () => changeMonth(1));

// --- The times for a day ---------------------------------------------------

function resetSlots() {
  slotsBox.replaceChildren();
  $('#slots-heading').hidden = true;
  $('#slots-loading').hidden = true;
  for (const id of ['#slots-empty', '#slots-error']) {
    $(id).classList.add('d-none');
    $(id).classList.remove('d-flex');
  }
  $('#zone-note').hidden = true;
  selectedSlot = null;
  updateContinue();
}

function showSlotsMessage(id) {
  $(id).classList.remove('d-none');
  $(id).classList.add('d-flex');
}

async function chooseDate(date) {
  selectedDate = date;
  renderCalendar();
  resetSlots();
  $('#time-prompt').hidden = true;
  $('#slots-loading').hidden = false;
  const request = ++slotRequest;

  try {
    const res = await fetch(
      `/api/availability?${new URLSearchParams({ serviceId: service.id, date, location: place })}`,
    );
    if (request !== slotRequest) return; // the client has moved on
    $('#slots-loading').hidden = true;

    if (res.status === 429) {
      $('#slots-error-text').textContent =
        'Too many requests. Please wait a moment and try again.';
      showSlotsMessage('#slots-error');
      return;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      $('#slots-error-text').textContent =
        body.code === 'SERVICE_UNAVAILABLE'
          ? "That service isn't available any more. Please choose another."
          : "We couldn't load the times. Please try again.";
      showSlotsMessage('#slots-error');
      return;
    }

    const data = await res.json();
    $('#slots-heading').textContent = formatDay(date);
    $('#slots-heading').hidden = false;
    if (data.slots.length === 0) {
      showSlotsMessage('#slots-empty'); // "No times are available on this day"
      return;
    }
    slotsBox.replaceChildren(...data.slots.map(slotButton));
    $('#zone-note').textContent = `Times are in ${zoneName(data.timeZone)}.`;
    $('#zone-note').hidden = false;
  } catch {
    if (request !== slotRequest) return;
    $('#slots-loading').hidden = true;
    $('#slots-error-text').textContent =
      "Can't reach the server. Check your connection and try again.";
    showSlotsMessage('#slots-error');
  }
}

function zoneName(timeZone) {
  const short = zoneShortName(timeZone);
  return timeZone === 'Africa/Johannesburg'
    ? `South African time (${short})`
    : `${timeZone} time (${short})`;
}

function slotButton(slot) {
  const button = el(
    'button',
    'btn btn-outline-primary mbg-slot',
    slot.localTime,
  );
  button.type = 'button';
  button.setAttribute('aria-pressed', 'false');
  button.addEventListener('click', () => {
    selectedSlot = slot;
    for (const other of slotsBox.children) {
      other.classList.toggle('active', other === button);
      other.setAttribute('aria-pressed', String(other === button));
    }
    updateContinue();
  });
  return button;
}

// --- Continue --------------------------------------------------------------

function updateContinue() {
  const note = $('#continue-note');
  if (!selectedSlot) {
    continueButton.disabled = true;
    continueButton.textContent = 'Continue';
    note.textContent = 'Choose a date and a time first.';
    return;
  }
  continueButton.textContent = `Continue with ${selectedSlot.localTime}`;
  if (NEXT_STEP_READY) {
    continueButton.disabled = false;
    note.textContent = `${formatDay(selectedDate)} at ${selectedSlot.localTime}`;
  } else {
    continueButton.disabled = true;
    note.textContent =
      'Entering your details is the next step, and it opens soon. Nothing is reserved yet.';
  }
}

continueButton.addEventListener('click', () => {
  // The details page (#51) takes the service and the chosen start time.
  location.assign(
    `/book-details.html?${new URLSearchParams({ service: service.id, start: selectedSlot.startAt, location: place })}`,
  );
});

load();
