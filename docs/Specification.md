# Service Booking System — Specification

*Version 1.0 · Approved · 10 October 2026*

## 1. Purpose

The Service Booking System lets appointment-based businesses publish services, expose availability, and take bookings online, while giving the owner a secure portal to manage the schedule. The reference implementation is for a makeup artist business, **Make Up by Glory**. The core is business-agnostic: another provider (hair stylist, barber, tutor, trainer) can use it by changing configuration, not booking logic.

**Portfolio goals.** Demonstrate real-world full-stack delivery: relational design, availability calculation, double-booking prevention, authentication and authorization, secure file upload, notifications behind an abstraction, automated testing and CI/CD.

## 2. Scope

**In scope (v1)**

- Public client website: browse services, view availability, book without an account, receive instructions and confirmation, view booking details, upload proof of payment and cancel through the booking link.
- Deposit workflow: one fixed deposit percentage applied to every service, manual EFT payment, proof of payment uploaded through the booking link (or sent by email as a fallback), owner verification before confirmation.
- Administrator portal: dashboard, bookings, proof-of-payment review, services, availability and blocked times, calendar view, settings.
- Email notifications (real provider). SMS is deferred; the notification interface keeps it pluggable.
- Automated tests, documentation in `docs/`, CI/CD and deployment.

**Out of scope (v1)** — an online payment gateway (deposits are paid by EFT and verified manually in v1), automatic reading or validation of proof-of-payment documents (OCR, bank API checks), reminders, rescheduling, cancellation fees or policies beyond the deposit refund rule (BR-12), client accounts, reviews, discounts, multiple providers or locations, analytics, calendar sync, AI assistance. See section 13.

## 3. Users and roles

| Role | Authenticated | Capabilities |
| --- | --- | --- |
| Client | No | Browse services, check availability, create a booking, view own booking details, upload proof of payment for and cancel own booking |
| Administrator (service provider) | Yes | Everything in the portal: services, availability, bookings, proof-of-payment review, calendar |

v1 assumes a single provider. The administrator account is created by a seed script from environment variables: there is no sign-up and no password-reset screen, and the owner resets her password by running the script. Role-based authorization is still enforced so more roles can be added later.

## 4. Functional requirements

### 4.1 Client website

| ID | Requirement |
| --- | --- |
| C-1 | View business information and the list of active services with description, price, duration and deposit amount. |
| C-2 | Select a service and a date, then see only time slots that fit the service's duration, avoid overlapping bookings and blocked periods, and respect the minimum-notice and maximum-advance settings. |
| C-3 | Submit a booking with name, email, phone and optional notes. No account required. |
| C-4 | The booking is re-validated on the server at submission; if the slot is gone, the client gets a clear error and can pick another. |
| C-5 | Once the client has chosen an available slot and submitted their details (selected service, date and time, name, email, phone and optional notes), they see a confirmation page with the booking reference, the deposit amount and payment deadline (when a deposit applies), and a message that the booking will be confirmed once the deposit is paid and payment instructions have been sent to their email, plus a fallback option to send proof by email. The client then receives an email with the payment instructions: deposit amount, banking details, the booking reference to use as the payment reference, the deadline, a statement that the booking is confirmed only once payment is received, and their unique **booking link** for uploading proof of payment and, if needed, cancelling the booking (BR-15). |
| C-6 | Client can view their booking details by entering the booking reference and the email used to book. The details page shows the payment status (awaiting payment, proof received, proof rejected with reason, confirmed) and, while the booking is Pending or Confirmed, a button to resend the booking email with a new booking link. |
| C-7 | **Booking page.** Opening the booking link shows a short booking summary (reference, service, date and time, status, deposit amount, deadline, banking details). While the booking is Pending it has an upload control for proof of payment (rules in BR-14), with upload progress, a clear error for invalid files, and a success message stating that the booking is confirmed only once the owner sees the money in her account. |
| C-8 | **Cancel booking.** While the booking is Pending or Confirmed and the appointment has not started, the booking page has a Cancel booking button. Before confirming, the client sees whether their deposit is refundable under BR-12. After cancelling, the client receives a cancellation email and the slot is freed. |

### 4.2 Administrator portal

| ID | Requirement |
| --- | --- |
| A-1 | Log in securely; all admin routes require authentication and authorization. |
| A-2 | Dashboard: today's bookings, upcoming bookings, completed this month, bookings awaiting deposit, **bookings with proof awaiting review**, refunds due, and a list of upcoming appointments. |
| A-3 | List and filter bookings (including by "proof received"); open a booking to see client details, service, date, time, price, deposit, status, notes and any uploaded proofs. |
| A-4 | Confirm payment (only after the money reflects in the bank account), cancel, extend a deposit deadline, and mark bookings completed or no-show. |
| A-5 | Create, edit and deactivate services (name, description, price, duration, active flag). |
| A-6 | Configure working days and hours; block whole dates or time ranges. |
| A-7 | Calendar view of appointments (FullCalendar), with access to booking details. |
| A-8 | Settings: minimum notice, maximum advance booking window, slot interval, buffer time, deposit percentage, deposit refund rule, deposit hold duration, time zone and banking details shown to clients. |
| A-9 | **Review proof of payment.** View or download each uploaded proof in the portal, and mark it Accepted or Rejected (with a reason shown to the client, e.g. "amount does not match"). Rejecting a proof notifies the client and lets them upload again. Accepting a proof does not confirm the booking by itself; Confirm payment (A-4) remains a separate action taken after the bank check. |

## 5. Business rules

**BR-1 Slot calculation.** A time is offered only if `start + service duration` fits inside working hours and does not overlap any active booking (Pending or Confirmed) or blocked period, and the start time is outside the minimum-notice window and within the maximum advance window. Multiple appointments per day are allowed.

**BR-2 No double-booking.** Availability is authoritative on the server. Two simultaneous requests for overlapping times must result in exactly one success and one rejection. This is enforced at the database as well as in code, using a PostgreSQL exclusion constraint on the booking time range (`btree_gist`), ignoring cancelled and expired bookings but counting Pending ones, and map the violation to a friendly conflict error.

**BR-3 Booking statuses.** Pending (awaiting deposit), Confirmed, Completed, No-show, Cancelled, and Expired (deposit deadline passed). If the provider's deposit percentage is 0, bookings skip Pending and start Confirmed. **Transitions:**

| From | To |
| --- | --- |
| Pending | Confirmed (owner verifies payment), Cancelled, Expired |
| Confirmed | Completed, No-show, Cancelled |
| Completed, No-show, Cancelled, Expired | (terminal) |

Only the administrator changes status, with two exceptions: a scheduled job sets Expired, and the client can cancel their own Pending or Confirmed booking through the booking link (BR-12). Cancelled and expired bookings free their slot. Uploading proof of payment never changes booking status; it is tracked separately on the PaymentProof record (BR-14).

**BR-4 Price and duration snapshot.** A booking stores the service price and duration at booking time so later edits to the service don't alter history.

**BR-5 Inactive services** are hidden from clients and cannot be newly booked; existing bookings are unaffected.

**BR-6 Time zone.** Times are stored in UTC, and working hours are interpreted in the business's configured time zone (South Africa Standard Time for the reference business).

**BR-7 Deposits.** The provider sets one global deposit percentage in settings (0 means no deposit), applied to the service price when a booking is made. The resulting deposit amount is stored on the booking. A per-service override is a possible future option.

**BR-8 Manual payment verification.** In v1 the client pays the deposit by EFT using the booking reference as the payment reference, then uploads proof of payment through the booking link (or sends it by email as a fallback). The owner confirms the booking only after the money reflects in her bank account, never from the proof alone: proofs can be forged, and an "immediate payment" notice can be reversed. The system records the amount received, the date and the confirming administrator. Payment sits behind a `PaymentProvider` interface (manual EFT first) so a gateway can replace it later without changing booking logic.

**BR-9 Deposit hold.** A Pending booking holds its slot until its deposit deadline: the earlier of the hold duration after booking and the minimum-notice cutoff before the appointment. Hold duration is a provider setting; the reference business uses 24 hours. A scheduled job marks overdue bookings Expired and frees the slot. The owner can extend a deadline or cancel any Pending booking. Uploading a proof does not change the deadline or stop the expiry job: the owner is notified of every upload (BR-14) and decides whether to confirm payment, reject the proof, extend the deadline while she checks, or let the booking expire.

**BR-10 Minimum notice and advance window.** A provider setting in hours (24 for the reference business) blocks bookings that start sooner, and a maximum advance window in days (90 for the reference business) blocks bookings too far ahead. Both are applied in slot calculation and re-checked at submission.

**BR-11 Booking limits.** Each email address or phone number may have at most 2 active Pending bookings, and the booking endpoint is rate-limited.

**BR-12 Cancellation and deposit refunds.** The client can cancel their own booking through the booking link (BR-15) while it is Pending or Confirmed and before the appointment starts; the owner can also cancel from the portal. Cancelling takes two steps (open the booking page, then confirm), never a single click on an email link, so email link scanners cannot trigger it. Settings define whether deposits are refundable and, if so, the cut-off in hours before the appointment. The reference business refunds deposits when the client cancels at least 24 hours before the appointment, matching its 24-hour minimum notice. When a Confirmed booking is cancelled within the refund rule, the owner is notified that a refund is due; in v1 she pays it manually and the booking records that the refund was issued. A Pending booking has no verified deposit, so nothing is marked as due; if the client had already paid, the owner checks her bank and refunds manually. Cancelling frees the slot and emails both the client and the owner.

**BR-13 Slot interval and buffer.** Start times fall on a provider-set interval within working hours (`slotIntervalMinutes`; the reference business uses 120). After every booking a provider-set buffer (`bufferMinutes`; the reference business uses 60) blocks the following time. A booking therefore occupies its service duration plus the buffer, and a start time is offered only if that whole span is free. A per-service buffer override is a possible future option.

**BR-14 Proof-of-payment upload.** A client uploads proof only for a Pending booking, through its booking link (BR-15); uploads are refused for any other status. Accepted files are PDF, JPEG and PNG, checked from the file's content (magic bytes) rather than its extension, at most 5 MB each and 3 per booking, which allows a re-upload after a rejection. Files are stored privately outside the web root under a random key, never served from `public/` or a guessable URL, and only an authenticated administrator can view or download them. Each proof is Received, then Accepted or Rejected; a rejection reason is shown to the client, and rejected proofs are kept for the audit trail. A new upload notifies the administrator by email with the booking reference, client name, deposit amount, current deadline and a link to the booking in the portal; a rejection notifies the client with the reason and asks them to upload a new proof using the booking link in their original payment instructions email (or to request a new one from the booking details page, C-6). The rejection email does not contain a booking link. Proof files are deleted 90 days after the booking reaches a terminal state (Completed, No-show, Cancelled or Expired) by a daily scheduled job, keeping only the metadata, in line with POPIA. The 90-day period is a fixed system rule, not a provider setting, so it cannot be shortened or extended from the portal. The upload endpoint is rate-limited per booking and per IP address.

**BR-15 Booking link.** When a booking is created, the server generates a random booking token (32 bytes from a cryptographically secure generator) and builds the link `/booking/<token>`, which is sent only in the booking email (payment instructions, or confirmation when no deposit applies) and never returned by the API or shown on screen. Only a SHA-256 hash of the token is stored, so a database leak does not expose working links. The link works while the booking is Pending or Confirmed and the appointment has not started. It shows a booking summary, allows proof upload only while Pending, and allows cancellation (BR-12); it cannot change the date, time or service. An unknown or inactive link gets the same generic "link not valid" response, so links cannot be probed. A new link can be issued by the client from the booking details page (C-6) or by the owner from the portal; either way the old link stops working and the new one is emailed to the booking's email address only.

## 6. Domain model

Key fields for each entity are listed below. The full design (types, constraints, indexes) lives in `docs/database.md`.

| Entity | Key fields |
| --- | --- |
| User | id, email, passwordHash, role, createdAt |
| Service | id, name, description, price, durationMinutes, isActive |
| Availability | id, dayOfWeek, startTime, endTime, isWorkingDay |
| BlockedTime | id, startAt, endAt, reason |
| Booking | id, reference (e.g. BK-000123), serviceId, clientName, clientEmail, clientPhone, startAt, endAt, occupiedUntil (endAt plus the buffer at booking time), priceAtBooking, depositAmount, depositDueAt, bookingTokenHash, bookingTokenCreatedAt, amountReceived, paymentVerifiedAt, paymentVerifiedBy, refundDue, refundedAt, cancelledAt, cancelledBy (client/admin), status, notes, createdAt |
| PaymentProof | id, bookingId, storageKey, originalFilename, contentType, sizeBytes, sha256, status (Received/Accepted/Rejected), rejectionReason, uploadedAt, uploadedFromIp, reviewedAt, reviewedBy, fileDeletedAt |
| Notification | id, bookingId, channel (email/sms), recipient, type, status, sentAt, error |
| Setting | minNoticeHours, maxAdvanceDays, slotIntervalMinutes, bufferMinutes, depositPercent, depositRefundable, refundCutoffHours, depositHoldHours, timeZone, bankingDetails |

Relationships: Service 1—\* Booking; Booking 1—\* Notification; Booking 1—\* PaymentProof; User 1—\* PaymentProof (as reviewer). The `sha256` hash lets the owner spot the same file being reused across bookings.

## 7. Architecture

A modular NestJS REST API in front of PostgreSQL, serving a static HTML/Bootstrap/vanilla-JS frontend.

| Module | Responsibility |
| --- | --- |
| auth | Administrator login, password hashing, authorization guards |
| services | Service CRUD and public listing |
| availability | Working hours, blocked times, slot calculation, notice and advance windows |
| bookings | Create, view, status changes, conflict handling, deposit deadline and expiry job |
| payments | Deposit calculation, `PaymentProvider` interface, manual EFT verification, proof-of-payment upload, validation and review |
| storage | `FileStorage` interface for saving, reading and deleting files; local-disk provider for development and tests, private cloud blob provider for production |
| notifications | Email (SMS later) behind an interface; mock and real providers |
| settings | Minimum notice, advance window, slot interval, buffer, deposit percentage, refund rule, deposit hold duration, time zone, banking details |
| admin | Dashboard, calendar data, booking management and proof review endpoints |

**Booking flow.** View services → select service → select date → availability check → select time → enter details → submit → server-side availability, notice and limit checks → on failure return error; otherwise create the booking (Pending if a deposit applies, else Confirmed) and its booking link → show the confirmation page → email the client (payment instructions with the booking link, or confirmation) and notify the administrator → client pays by EFT, then uploads proof through the booking link in the email (or sends it by email) → administrator is notified of the upload → owner checks the money is in the bank, reviews the proof and clicks Confirm payment, or extends the deadline while she checks → client receives confirmation. If the deadline passes before the owner confirms or extends it, the booking expires and the slot reopens. The client can cancel through the booking link at any point before the appointment.

**Upload flow.** The client opens the booking link and sends a `multipart/form-data` request → the server hashes the token, finds the booking, and checks Pending status, proof count and rate limit → streams the file with a size cap (rejecting oversize uploads without buffering them in full) → checks content type from the file's bytes → computes the SHA-256 hash → saves through `FileStorage` → creates the PaymentProof record → emits a `ProofUploaded` domain event. If the database write fails, the stored file is deleted so no orphan files remain; a periodic cleanup also removes any stray files.

**Notifications design.** The bookings and payments modules emit domain events; the notifications module subscribes, so providers (Nodemailer, an SMS gateway) are swappable and business logic is not coupled to them. A notification failure is logged on the Notification record and never rolls back or blocks the booking or the upload.

**Messages.** To the client: booking received with payment instructions, deadline and booking link; proof rejected with reason; booking confirmed; booking cancelled (by the client or the owner) or expired. To the administrator: every new booking; every new proof upload; every client cancellation, flagged when a refund is due.

## 8. API surface

All paths are under `/api` (for example `GET /api/services`); pages, including the booking link `/booking/<token>`, are served from the site root.

| Method and path | Access | Purpose |
| --- | --- | --- |
| `GET /services` | Public | Active services with deposit amounts |
| `GET /availability?serviceId&date` | Public | Open slots for a service on a date |
| `POST /bookings` | Public | Create booking (Pending if a deposit applies); returns the reference and deposit summary (the booking link is sent by email only) |
| `POST /bookings/:reference/lookup` | Public (reference + email, email in the request body) | View own booking, including proof statuses |
| `POST /bookings/:reference/resend-booking-link` | Public (reference + email) | Issue a new booking link and email it; rate-limited |
| `GET /booking/:token` | Public (booking link) | Booking summary, status and refund eligibility for the booking page |
| `POST /booking/:token/proofs` | Public (booking link) | Upload a proof of payment (`multipart/form-data`, field `file`); rate-limited |
| `POST /booking/:token/cancel` | Public (booking link) | Cancel the booking (Pending or Confirmed, before the appointment starts) |
| `POST /admin/bookings/:id/booking-link` | Admin | Regenerate the booking link and email it to the client |
| `POST /auth/login` | Public | Administrator login |
| `POST /auth/logout` | Admin | Sign out |
| `GET /admin/dashboard` | Admin | Dashboard figures |
| `GET /admin/bookings`, `GET /admin/bookings/:id` | Admin | List and detail, including proofs |
| `GET /admin/payment-proofs/:id/file` | Admin | Stream or download a proof file |
| `PATCH /admin/payment-proofs/:id` | Admin | Accept or reject a proof (with reason) |
| `POST /admin/bookings/:id/confirm-payment` | Admin | Record amount received and confirm |
| `PATCH /admin/bookings/:id/deadline` | Admin | Extend deposit deadline |
| `PATCH /admin/bookings/:id/status` | Admin | Cancel, complete or mark no-show |
| `POST /admin/bookings/:id/refund` | Admin | Record that a refund due has been paid |
| `GET /admin/calendar?from&to` | Admin | Appointments for the calendar view |
| `GET/POST /admin/services`, `PATCH/DELETE /admin/services/:id` | Admin | List (including inactive) and manage services |
| `GET/PUT /admin/availability` | Admin | Working hours |
| `GET/POST /admin/blocked-times`, `DELETE /admin/blocked-times/:id` | Admin | List, block and unblock time |
| `GET/PATCH /admin/settings` | Admin | All settings in A-8 |

Upload errors: `400` invalid or missing file, `404` booking link not valid (unknown, regenerated or inactive, all with the same message), `409` booking not Pending or proof limit reached, `413` file too large, `415` unsupported file type, `429` rate limit. The full API specification lives in `docs/api.md`.

## 9. Non-functional requirements

**Security**

- Password hashing; secure authentication; role-based authorization on every admin route.
- Client-side and server-side input validation; server is authoritative.
- Client personal data (name, email, phone, proof-of-payment documents, which can show bank account details) handled securely and in line with POPIA for a South African deployment; what is stored, why and for how long is documented in `docs/security.md`.
- Secrets via environment configuration; no credentials in source control; `.env.example` committed.
- Public booking lookup and proof upload must not allow enumeration of other clients' bookings: the same generic error is returned for a wrong reference and a wrong email, and for any invalid booking link.
- Booking links are unguessable random tokens stored only as hashes (BR-15). The booking page sends `Referrer-Policy: no-referrer`, loads no third-party scripts, and request logging masks the token in `/booking/...` paths so links don't leak through logs or referrer headers. Opening the link (a `GET`) never changes a booking; cancelling needs a `POST` from the page's confirm button.
- Booking creation is rate-limited and capped at 2 active Pending bookings per email or phone number.
- Uploaded files are validated by content, size-capped while streaming, stored privately under random keys, never executed or served publicly, and returned to administrators with `Content-Disposition: attachment` (or rendered inline only for verified PDF and image types) plus `X-Content-Type-Options: nosniff`. Malware scanning is enabled on the production storage account if the hosting choice offers it.
- Payment is confirmed only by an authenticated administrator after funds reflect in the bank account; each confirmation and each proof review is recorded with who and when.

**Quality**

- Business logic covered by automated tests (section 10).
- Public pages responsive and usable on mobile, including uploading a screenshot or file from a phone.
- Availability responses fast enough to feel instant on a single-provider dataset.

## 10. Testing strategy

| Level | Coverage |
| --- | --- |
| Unit | Service validation, availability calculation, booking validation, status transitions, deposit calculation, minimum-notice and deadline logic, file type and size validation, proof status transitions, notification triggers |
| Integration | Database operations, booking creation, availability checks, expiry job freeing slots (including bookings with an unreviewed proof), Pending-booking limits, booking link creation, hashing and regeneration, proof upload to local storage and record creation, orphan-file cleanup, retention deletion after 90 days, client cancellation freeing the slot and flagging refunds due, authentication, authorization |
| Concurrency | Two clients booking the same or overlapping slot simultaneously: exactly one succeeds. Parallel uploads to one booking never exceed the proof limit |
| API | Endpoint contracts and error responses, including every upload error code; a file with a `.pdf` extension but other content is rejected; a client cannot upload to or view another client's booking; an invalid, regenerated or inactive booking link returns the same `404`; proof files are unreachable without admin authentication; opening the booking link never changes the booking; cancelling after the appointment has started is refused |

The concurrency test is the most important: preventing double-booking is the system's core requirement.

## 11. Technology

- **Backend:** Node.js, TypeScript, NestJS, REST, PostgreSQL with an ORM or query library. File uploads through NestJS's Multer integration (`FileInterceptor`) with size limits, and content-type detection from file bytes (for example the `file-type` package).
- **File storage:** local disk in development and tests; private blob storage in production (Azure Blob Storage if the hosting recommendation is accepted), behind the `FileStorage` interface.
- **Frontend:** HTML5, CSS3, Bootstrap, Bootstrap Icons, vanilla JavaScript (`FormData` and `fetch` for uploads), FullCalendar. No React, Angular or Vue, by design.
- **Notifications:** Nodemailer for email; SMS provider to be selected.
- **Tooling:** Git, GitHub, GitHub Actions, npm.

## 12. Delivery plan

Work is tracked as GitHub milestones and issues; each milestone is done when its "Done when" condition is met.

| Milestone | Outcome |
| --- | --- |
| M0 Requirements & design | Approved specification, database design, API, wireframes and email content in `docs/`; open question 1 decided; GitHub labels, milestones, templates and project board |
| M1 Foundation | NestJS project, TypeScript, PostgreSQL in Docker, migrations, environment config, test framework, CI, static frontend layout, protected `main` and contribution workflow |
| M2 Services | Administrator account and login, settings, service model, admin service management, public service listing |
| M3 Availability | Working hours, blocked dates and times, time zone handling, slot calculation, minimum notice and advance window, date and time picker |
| M4 Bookings | Creation, validation, booking references, deposit and deadline, Pending/Confirmed lifecycle, booking link, booking limits, expiry job, double-booking prevention, booking lookup |
| M5 Notifications | Email provider (mock first, then Nodemailer), payment instructions email with the booking link, resend booking link, status emails, admin notification of new bookings, notification history (SMS deferred) |
| M6 Admin portal & proof of payment | Dashboard, booking management, payment verification, booking page, proof upload and review, client cancellation, refunds due, settings and calendar |
| M7 Testing & hardening | Upload, authorization, booking link and enumeration security tests, API contract and end-to-end tests, mobile and accessibility check, security and POPIA review |
| M8 Deployment | Hosting decision, production resources and private blob storage, configuration and secrets, deployment workflow, monitoring and logging, v1.0 release |

Repository layout: `src/{auth,bookings,services,availability,payments,storage,notifications,settings,admin}`, `public/`, `tests/`, `docs/`, `.env.example`, `README.md`. Local uploads go to a git-ignored `uploads/` folder outside `public/`.

## 13. Future enhancements

A payment gateway with automatic confirmation and refunds (making proof upload unnecessary for card payments), automatic proof checks (OCR of amount and reference), automated reminders, rescheduling, cancellation policies, client accounts, reviews, promotions, multiple providers and locations, analytics and revenue reporting, calendar synchronization, SMS notifications, AI-powered booking assistance.

## 14. Acceptance criteria for v1

1. A client can complete a booking end to end without an account and receives payment instructions or a confirmation.
2. No two active bookings (Pending or Confirmed) can overlap, including under concurrent requests.
3. Offered slots always respect service duration, working hours, blocked time, minimum notice and the advance window.
4. A Pending booking holds its slot until the owner confirms payment or its deadline passes, then the slot reopens.
5. The administrator can manage services, deposits, availability, blocked times and settings, confirm payments, change booking statuses and view the calendar.
6. Admin routes are inaccessible without valid authentication and authorization.
7. Notification failures never lose or block a booking.
8. CI runs the test suite on every push and the app is deployed.
9. After submitting a booking, a client receives an email with payment instructions and a booking link, and can use it to upload a valid proof of payment from a phone or desktop while the booking is Pending; the administrator is notified of each upload; invalid, oversized or excess files are rejected with clear messages; only an authenticated administrator can view proofs; and uploading a proof never confirms a booking on its own.
10. A client can cancel their own Pending or Confirmed booking through the booking link before the appointment starts; the slot reopens, the client and the owner are emailed, and the owner is told when a refund is due.

## 15. Open questions

1. **Slot interval.** Set to 2 hours for the reference business. With a 1-hour buffer, most bookings (1h30 to 2h30 plus buffer) will use two 2-hour slots, so a day fits about two appointments. A 30-minute interval would fit more. This is a setting, so it can change without code changes; to be decided in M0.
2. **Hosting target.** Recommended: Azure App Service plus Azure Database for PostgreSQL in South Africa North, deployed by GitHub Actions, with Azure Blob Storage (private container) for proof files. To be decided in M8.
