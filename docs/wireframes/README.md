# Wireframes

Low-fidelity, clickable wireframes for every v1 screen (#12). The home page and Website section are specified in C-9, A-10 and BR-16. They show layout, content, states and flow, not visual design: grey boxes, sample data, and yellow notes explaining behaviour with links to the [specification](../specification.md) and [API](../api.md).

## Viewing them

The wireframes are plain HTML pages using Bootstrap from a CDN, so they need a browser rather than GitHub's file view.

- **On your computer:** open [`index.html`](index.html) in a browser (double-click it in your file explorer). Every screen links to the others.
- **Phone layout:** in the browser, open developer tools (F12) and switch to a phone-sized view.

## Screens

### Client website

| # | Screen | File | Covers | States shown |
| --- | --- | --- | --- | --- |
| 0 | Home | [client/home.html](client/home.html) | C-1, C-9 | Hero with Book now; About; services preview; gallery with service filter; testimonials; booking policies generated from settings; FAQ; hours, area and contact |
| 1 | Services | [client/services.html](client/services.html) | C-1, BR-5, BR-7 | Full service list with deposits; where every Book now lands |
| 2 | Date and time picker | [client/pick-time.html](client/pick-time.html) | C-2, BR-9, BR-10 | Dates outside the booking window disabled; day with times; day with no times |
| 3 | Booking form | [client/book.html](client/book.html) | C-3, C-4, BR-11 | Validation error; time just taken (`409`); booking limit reached |
| 4 | Confirmation | [client/confirmation.html](client/confirmation.html) | C-5 | Pending with payment steps; Confirmed when no deposit applies |
| 5 | Booking details lookup | [client/lookup.html](client/lookup.html) | C-6 | Not found; found with a rejected proof; new link requested |
| 6 | Booking page | [client/booking.html](client/booking.html) | C-7, C-8, BR-12, BR-14, BR-15 | Pending with banking details and upload (uploading, uploaded, errors); cancel confirmation; Confirmed with refund rule; link not valid |

### Administrator portal

| # | Screen | File | Covers | States shown |
| --- | --- | --- | --- | --- |
| 1 | Login | [admin/login.html](admin/login.html) | A-1 | Wrong details; too many attempts |
| 2 | Dashboard | [admin/dashboard.html](admin/dashboard.html) | A-2 | Six figures linking to filtered lists; upcoming appointments |
| 3 | Bookings list | [admin/bookings.html](admin/bookings.html) | A-3 | Filters, search, pagination; proofs awaiting review highlighted |
| 4 | Booking detail | [admin/booking.html](admin/booking.html) | A-3, A-4, A-9, BR-8, BR-15 | Actions by status; proofs with reuse warning; confirm payment, extend deadline, reject proof and cancel dialogs; email history |
| 5 | Services | [admin/services.html](admin/services.html) | A-5, BR-4, BR-5 | Active and inactive services; add/edit dialog |
| 6 | Availability | [admin/availability.html](admin/availability.html) | A-6 | Weekly hours; blocked times; block overlapping existing bookings |
| 7 | Settings | [admin/settings.html](admin/settings.html) | A-8 | All settings grouped: business, booking rules, deposits and refunds, banking |
| 8 | Calendar | [admin/calendar.html](admin/calendar.html) | A-7 | Week view; Pending, Confirmed and blocked shown differently |
| 9 | Website | [admin/website.html](admin/website.html) | A-10 | Tabs for About and hero photo, contact and area, gallery (upload with consent, caption, service tag, reorder, hide), testimonials, FAQ |

## Main flows

- **Book:** Home → Book now → Services → Date and time → Booking form → Confirmation
- **Pay:** Booking page (from the email link) → upload proof → admin Booking detail → Confirm payment
- **Cancel:** Booking page → Cancel booking → confirm
- **Update the website:** admin Website → About, gallery, testimonials, FAQ → View site
- **Find a booking:** Find my booking → details → email me a new booking link

## Conventions

- **Sample data:** today is Saturday 10 October 2026 at 14:00; Sarah Mokoena books Soft Glam (1h 30m, R650, 50% deposit R325) for Tuesday 13 October at 09:00. Times are South African Standard Time.
- **Status without colour:** statuses are written out and drawn with solid or dashed outlines, so the wireframes don't rely on colour; the real design must keep them distinguishable without colour too.
- **Not final:** wording and layout are a starting point for the frontend issues (M1–M6). The approved email wording lives in `docs/emails.md` (#13).
