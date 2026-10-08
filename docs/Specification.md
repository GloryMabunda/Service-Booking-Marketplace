# Service Booking System — Specification

*Version 0.5 · 8 October 2026 · Status: Draft for review*

This specification is derived from the project README. Where the README is silent, content is marked **Proposed** so it can be accepted or changed.

## 1. Purpose

The Service Booking System lets appointment-based businesses publish services, expose availability, and take bookings online, while giving the owner a secure portal to manage the schedule. The reference implementation is for a makeup artist business, **Make Up by Glory**. The core is business-agnostic: another provider (hair stylist, barber, tutor, trainer) can use it by changing configuration, not booking logic.

**Portfolio goals.** Demonstrate real-world full-stack delivery: relational design, availability calculation, double-booking prevention, authentication and authorization, notifications behind an abstraction, automated testing and CI/CD.

## 2. Scope

**In scope (v1)**

- Public client website: browse services, view availability, book without an account, receive instructions and confirmation, view booking details.
- Deposit workflow: per-service deposit rules, manual EFT payment, proof of payment sent by email or WhatsApp, owner verification before confirmation.
- Administrator portal: dashboard, bookings, services, availability and blocked times, calendar view, settings.
- Email notifications (real provider). SMS is deferred; the notification interface keeps it pluggable.
- Automated tests, documentation in `docs/`, CI/CD and deployment.

**Out of scope (v1)** — an online payment gateway (deposits are paid by EFT and verified manually in v1), reminders, rescheduling, cancellation policies, client accounts, reviews, discounts, multiple providers or locations, analytics, calendar sync, WhatsApp, AI assistance. See section 13.

## 3. Users and roles

| Role | Authenticated | Capabilities |
| --- | --- | --- |
| Client | No | Browse services, check availability, create a booking, view own booking details |
| Administrator (service provider) | Yes | Everything in the portal: services, availability, bookings, calendar |

v1 assumes a single provider. The administrator account is created by a seed script from environment variables: there is no sign-up and no password-reset screen, and the owner resets her password by running the script. Role-based authorization is still enforced so more roles can be added later.

## 4. Functional requirements

### 4.1 Client website

| ID | Requirement |
| --- | --- |
| C-1 | View business information and the list of active services with description, price, duration and deposit amount. |
| C-2 | Select a service and a date, then see only time slots that fit the service's duration, avoid overlapping bookings and blocked periods, and respect the minimum-notice and maximum-advance settings. |
| C-3 | Submit a booking with name, email, phone and optional notes. No account required. |
| C-4 | The booking is re-validated on the server at submission; if the slot is gone, the client gets a clear error and can pick another. |
| C-5 | On success the client sees a confirmation page with the booking reference, the deposit amount, banking details and payment deadline (when a deposit applies), plus buttons to send proof of payment by WhatsApp (pre-filled with the reference) or email. The client also receives the same details by email. |
| C-6 | Client can view their booking details by entering the booking reference and the email used to book. |

### 4.2 Administrator portal

| ID | Requirement |
| --- | --- |
| A-1 | Log in securely; all admin routes require authentication and authorization. |
| A-2 | Dashboard: today's bookings, upcoming bookings, completed this month, bookings awaiting deposit, and a list of upcoming appointments. |
| A-3 | List and filter bookings; open a booking to see client details, service, date, time, price, deposit, status and notes. |
| A-4 | Confirm payment (only after the money reflects in the bank account), cancel, extend a deposit deadline, and mark bookings completed or no-show. |
| A-5 | Create, edit and deactivate services (name, description, price, duration, active flag). |
| A-6 | Configure working days and hours; block whole dates or time ranges. |
| A-7 | Calendar view of appointments (FullCalendar), with access to booking details. |
| A-8 | Settings: minimum notice, maximum advance booking window, slot interval, buffer time, deposit percentage, deposit refund rule, deposit hold duration and banking details shown to clients. |

## 5. Business rules

**BR-1 Slot calculation.** A time is offered only if `start + service duration` fits inside working hours and does not overlap any active booking (Pending or Confirmed) or blocked period, and the start time is outside the minimum-notice window and within the maximum advance window. Multiple appointments per day are allowed.

**BR-2 No double-booking.** Availability is authoritative on the server. Two simultaneous requests for overlapping times must result in exactly one success and one rejection. **Proposed:** enforce this at the database as well as in code, using a PostgreSQL exclusion constraint on the booking time range (`btree_gist`), ignoring cancelled and expired bookings but counting Pending ones, and map the violation to a friendly conflict error.

**BR-3 Booking statuses.** Pending (awaiting deposit), Confirmed, Completed, No-show, Cancelled, and Expired (deposit deadline passed). If the provider's deposit percentage is 0, bookings skip Pending and start Confirmed. **Transitions:**

| From | To |
| --- | --- |
| Pending | Confirmed (owner verifies payment), Cancelled, Expired |
| Confirmed | Completed, No-show, Cancelled |
| Completed, No-show, Cancelled, Expired | (terminal) |

Only the administrator changes status, except Expired, which a scheduled job sets. Cancelled and expired bookings free their slot.

**BR-4 Price and duration snapshot.** **Proposed:** a booking stores the service price and duration at booking time so later edits to the service don't alter history.

**BR-5 Inactive services** are hidden from clients and cannot be newly booked; existing bookings are unaffected.

**BR-6 Time zone.** **Proposed:** store UTC, interpret working hours in the business's configured time zone (South Africa Standard Time for the reference business).

**BR-7 Deposits.** The provider sets one global deposit percentage in settings (0 means no deposit), applied to the service price when a booking is made. The resulting deposit amount is stored on the booking. A per-service override is a possible future option.

**BR-8 Manual payment verification.** In v1 the client pays the deposit by EFT using the booking reference as the payment reference, then sends proof of payment by email or WhatsApp. The owner confirms the booking only after the money reflects in her bank account, never from the proof alone. The system records the amount received, the date and the confirming administrator. Payment sits behind a `PaymentProvider` interface (manual EFT first) so a gateway can replace it later without changing booking logic.

**BR-9 Deposit hold.** A Pending booking holds its slot until its deposit deadline: the earlier of the hold duration after booking and the minimum-notice cutoff before the appointment. Hold duration is a provider setting; the reference business uses 24 hours. A scheduled job marks overdue bookings Expired and frees the slot. The owner can extend a deadline or cancel any Pending booking.

**BR-10 Minimum notice and advance window.** A provider setting in hours (24 for the reference business) blocks bookings that start sooner, and a maximum advance window (**Proposed:** 90 days) blocks bookings too far ahead. Both are applied in slot calculation and re-checked at submission.

**BR-11 Booking limits.** Each email address or phone number may have at most 2 active Pending bookings, and the booking endpoint is rate-limited.

**BR-12 Cancellation and deposit refunds.** Settings define whether deposits are refundable and, if so, the cut-off in hours before the appointment. The reference business refunds deposits when the client cancels at least 24 hours before the appointment, matching its 24-hour minimum notice. In v1 the owner pays refunds manually and the booking records that the refund was issued.

**BR-13 Slot interval and buffer.** Start times fall on a provider-set interval within working hours (`slotIntervalMinutes`; the reference business uses 120). After every booking a provider-set buffer (`bufferMinutes`; the reference business uses 60) blocks the following time. A booking therefore occupies its service duration plus the buffer, and a start time is offered only if that whole span is free. A per-service buffer override is a possible future option.

## 6. Domain model

Entities named in the README: Users, Services, Availability, BlockedTimes, Bookings, Notifications. Fields below are **Proposed**.

| Entity | Key fields |
| --- | --- |
| User | id, email, passwordHash, role, createdAt |
| Service | id, name, description, price, durationMinutes, isActive |
| Availability | id, dayOfWeek, startTime, endTime, isWorkingDay |
| BlockedTime | id, startAt, endAt, reason |
| Booking | id, reference (e.g. BK-000123), serviceId, clientName, clientEmail, clientPhone, startAt, endAt, priceAtBooking, depositAmount, depositDueAt, amountReceived, paymentVerifiedAt, paymentVerifiedBy, refundedAt, status, notes, createdAt |
| Notification | id, bookingId, channel (email/sms), recipient, type, status, sentAt, error |
| Setting (added in 0.2) | minNoticeHours, maxAdvanceDays, slotIntervalMinutes, bufferMinutes, depositPercent, depositRefundable, refundCutoffHours, depositHoldHours, timeZone, bankingDetails |

Relationships: Service 1—\* Booking; Booking 1—\* Notification. The database design will be documented in `docs/`.

## 7. Architecture

A modular NestJS REST API in front of PostgreSQL, serving a static HTML/Bootstrap/vanilla-JS frontend.

| Module | Responsibility |
| --- | --- |
| auth | Administrator login, password hashing, authorization guards |
| services | Service CRUD and public listing |
| availability | Working hours, blocked times, slot calculation, notice and advance windows |
| bookings | Create, view, status changes, conflict handling, deposit deadline and expiry job |
| payments | Deposit calculation, `PaymentProvider` interface, manual EFT verification |
| notifications | Email (SMS later) behind an interface; mock and real providers |
| settings | Minimum notice, advance window, deposit percentage, refund rule, deposit hold duration, banking details |
| admin | Dashboard, calendar data, booking management endpoints |

**Booking flow.** View services → select service → select date → availability check → select time → enter details → submit → server-side availability, notice and limit checks → on failure return error; otherwise create the booking (Pending if a deposit applies, else Confirmed) → notify the client (payment instructions or confirmation) and the administrator → client pays by EFT and sends proof → owner confirms the money is in the bank and clicks Confirm payment → client receives confirmation. If the deadline passes first, the booking expires and the slot reopens.

**Notifications design.** The bookings module emits a domain event; the notifications module subscribes, so providers (Nodemailer, an SMS gateway) are swappable and booking logic is not coupled to them. **Proposed:** a notification failure is logged on the Notification record and never rolls back or blocks the booking.

**Messages.** To the client: booking received with payment instructions and deadline; booking confirmed; booking cancelled or expired. To the administrator: every new booking.

## 8. API surface (Proposed)

| Method and path | Access | Purpose |
| --- | --- | --- |
| `GET /services` | Public | Active services with deposit amounts |
| `GET /availability?serviceId&date` | Public | Open slots for a service on a date |
| `POST /bookings` | Public | Create booking (Pending if a deposit applies); returns payment instructions |
| `GET /bookings/:reference` | Public (reference + email) | View own booking |
| `POST /auth/login` | Public | Administrator login |
| `GET /admin/dashboard` | Admin | Dashboard figures |
| `GET /admin/bookings`, `GET /admin/bookings/:id` | Admin | List and detail |
| `POST /admin/bookings/:id/confirm-payment` | Admin | Record amount received and confirm |
| `PATCH /admin/bookings/:id/deadline` | Admin | Extend deposit deadline |
| `PATCH /admin/bookings/:id/status` | Admin | Cancel, complete or mark no-show |
| `POST/PATCH/DELETE /admin/services` | Admin | Manage services |
| `PUT /admin/availability` | Admin | Working hours |
| `POST/DELETE /admin/blocked-times` | Admin | Block and unblock time |
| `GET/PATCH /admin/settings` | Admin | Notice, advance window, deposit percentage, refund rule, hold duration, banking details |

A full API specification will live in `docs/`.

## 9. Non-functional requirements

**Security**

- Password hashing; secure authentication; role-based authorization on every admin route.
- Client-side and server-side input validation; server is authoritative.
- Client personal data (name, email, phone) handled securely; **Proposed:** consider POPIA obligations for a South African deployment.
- Secrets via environment configuration; no credentials in source control; `.env.example` committed.
- Public booking lookup must not allow enumeration of other clients' bookings.
- Booking creation is rate-limited and capped at 2 active Pending bookings per email or phone number.
- Payment is confirmed only by an authenticated administrator after funds reflect in the bank account; each confirmation is recorded with who and when.

**Quality**

- Business logic covered by automated tests (section 10).
- Public pages responsive and usable on mobile.
- **Proposed:** availability responses fast enough to feel instant on a single-provider dataset.

## 10. Testing strategy

| Level | Coverage |
| --- | --- |
| Unit | Service validation, availability calculation, booking validation, status transitions, deposit calculation, minimum-notice and deadline logic, notification triggers |
| Integration | Database operations, booking creation, availability checks, expiry job freeing slots, Pending-booking limits, authentication, authorization |
| Concurrency | Two clients booking the same or overlapping slot simultaneously: exactly one succeeds |
| API | Endpoint contracts and error responses |

The concurrency test is the most important: preventing double-booking is the system's core requirement.

## 11. Technology

- **Backend:** Node.js, TypeScript, NestJS, REST, PostgreSQL with an ORM or query library.
- **Frontend:** HTML5, CSS3, Bootstrap, Bootstrap Icons, vanilla JavaScript, FullCalendar. No React, Angular or Vue, by design.
- **Notifications:** Nodemailer for email; SMS provider to be selected.
- **Tooling:** Git, GitHub, GitHub Actions, npm.

## 12. Delivery plan

| Phase | Outcome |
| --- | --- |
| 1 Foundation | NestJS project, TypeScript, PostgreSQL, structure, environment config, Git workflow |
| 2 Services | Model, API, admin management, public listing |
| 3 Availability | Working hours, blocked dates and times, slot calculation, minimum notice and advance window, calendar interface |
| 4 Bookings | Creation, validation, Pending/Confirmed lifecycle, deposit deadline and expiry job, booking limits, double-booking prevention |
| 5 Administrator portal | Authentication, dashboard, booking, payment verification, service, settings and calendar management |
| 6 Notifications | Payment instructions, confirmations, admin notification, notification history (SMS deferred) |
| 7 Testing | Unit, integration, API, concurrency and auth tests |
| 8 Deployment | Production config, database, application, CI/CD, monitoring and logging |

Repository layout: `src/{auth,bookings,services,availability,notifications,admin}`, `public/`, `tests/`, `docs/`, `.env.example`, `README.md`.

## 13. Future enhancements

A payment gateway with automatic confirmation and refunds, automated reminders, rescheduling, cancellation policies, client booking lookup and accounts, reviews, promotions, multiple providers and locations, analytics and revenue reporting, calendar synchronization, SMS and WhatsApp notifications, AI-powered booking assistance.

## 14. Acceptance criteria for v1

1. A client can complete a booking end to end without an account and receives payment instructions or a confirmation.
2. No two active bookings (Pending or Confirmed) can overlap, including under concurrent requests.
3. Offered slots always respect service duration, working hours, blocked time, minimum notice and the advance window.
4. A Pending booking holds its slot until the owner confirms payment or its deadline passes, then the slot reopens.
5. The administrator can manage services, deposits, availability, blocked times and settings, confirm payments, change booking statuses and view the calendar.
6. Admin routes are inaccessible without valid authentication and authorization.
7. Notification failures never lose or block a booking.
8. CI runs the test suite on every push and the app is deployed.

## 15. Open questions

1. **Slot interval.** Set to 2 hours for the reference business. With a 1-hour buffer, most bookings (1h30 to 2h30 plus buffer) will use two 2-hour slots, so a day fits about two appointments. A 30-minute interval would fit more. This is a setting, so it can change without code changes; revisit before phase 3.
2. **Hosting target.** Recommended: Azure App Service plus Azure Database for PostgreSQL in South Africa North, deployed by GitHub Actions. Decide before phase 8.
