# API Specification

*Service Booking System · REST API · for [Specification v1.0](Specification.md), section 8*

This document describes every endpoint: method, path, access, request, response and errors. Field names match the database design in [`database.md`](database.md), converted to `camelCase`.

## Contents

1. [Conventions](#1-conventions)
2. [Errors](#2-errors)
3. [Rate limits](#3-rate-limits)
4. [Public endpoints](#4-public-endpoints)
5. [Booking link endpoints](#5-booking-link-endpoints)
6. [Authentication](#6-authentication)
7. [Admin endpoints](#7-admin-endpoints)
8. [Changes to the specification](#8-changes-to-the-specification)

### Endpoint index

| Method and path | Access | Section |
| --- | --- | --- |
| `GET /api/services` | Public | [4.1](#41-get-apiservices) |
| `GET /api/availability` | Public | [4.2](#42-get-apiavailability) |
| `POST /api/bookings` | Public | [4.3](#43-post-apibookings) |
| `POST /api/bookings/:reference/lookup` | Public (reference + email) | [4.4](#44-post-apibookingsreferencelookup) |
| `POST /api/bookings/:reference/resend-booking-link` | Public (reference + email) | [4.5](#45-post-apibookingsreferenceresend-booking-link) |
| `GET /api/booking/:token` | Booking link | [5.1](#51-get-apibookingtoken) |
| `POST /api/booking/:token/proofs` | Booking link | [5.2](#52-post-apibookingtokenproofs) |
| `POST /api/booking/:token/cancel` | Booking link | [5.3](#53-post-apibookingtokencancel) |
| `POST /api/auth/login` | Public | [6.1](#61-post-apiauthlogin) |
| `POST /api/auth/logout` | Admin | [6.2](#62-post-apiauthlogout) |
| `GET /api/admin/dashboard` | Admin | [7.1](#71-get-apiadmindashboard) |
| `GET /api/admin/bookings` | Admin | [7.2](#72-get-apiadminbookings) |
| `GET /api/admin/bookings/:id` | Admin | [7.3](#73-get-apiadminbookingsid) |
| `POST /api/admin/bookings/:id/confirm-payment` | Admin | [7.4](#74-post-apiadminbookingsidconfirm-payment) |
| `PATCH /api/admin/bookings/:id/deadline` | Admin | [7.5](#75-patch-apiadminbookingsiddeadline) |
| `PATCH /api/admin/bookings/:id/status` | Admin | [7.6](#76-patch-apiadminbookingsidstatus) |
| `POST /api/admin/bookings/:id/refund` | Admin | [7.7](#77-post-apiadminbookingsidrefund) |
| `POST /api/admin/bookings/:id/booking-link` | Admin | [7.8](#78-post-apiadminbookingsidbooking-link) |
| `GET /api/admin/payment-proofs/:id/file` | Admin | [7.9](#79-get-apiadminpayment-proofsidfile) |
| `PATCH /api/admin/payment-proofs/:id` | Admin | [7.10](#710-patch-apiadminpayment-proofsid) |
| `GET /api/admin/calendar` | Admin | [7.11](#711-get-apiadmincalendar) |
| `GET /api/admin/services` | Admin | [7.12](#712-services) |
| `POST /api/admin/services` | Admin | [7.12](#712-services) |
| `PATCH /api/admin/services/:id` | Admin | [7.12](#712-services) |
| `DELETE /api/admin/services/:id` | Admin | [7.12](#712-services) |
| `GET /api/admin/availability` | Admin | [7.13](#713-availability) |
| `PUT /api/admin/availability` | Admin | [7.13](#713-availability) |
| `GET /api/admin/blocked-times` | Admin | [7.14](#714-blocked-times) |
| `POST /api/admin/blocked-times` | Admin | [7.14](#714-blocked-times) |
| `DELETE /api/admin/blocked-times/:id` | Admin | [7.14](#714-blocked-times) |
| `GET /api/admin/settings` | Admin | [7.15](#715-settings) |
| `PATCH /api/admin/settings` | Admin | [7.15](#715-settings) |

---

## 1. Conventions

| Topic | Rule |
| --- | --- |
| Base path | Every endpoint is under `/api`. Pages are served from the site root, so the booking link `/booking/<token>` (BR-15) opens the booking page, and that page calls `GET /api/booking/<token>`. |
| Format | Requests and responses are JSON (`Content-Type: application/json`), except the proof upload (`multipart/form-data`) and the proof download (the file itself). JSON request bodies are limited to 16 KB. |
| Names | `camelCase` fields. Unknown fields in a request body are rejected with `400 VALIDATION_FAILED`. |
| IDs | UUIDs, used in admin paths only. Clients only ever see booking references (`BK-000123`). |
| Money | Strings with two decimals, in South African Rand: `"650.00"`. Never JSON numbers, so no rounding errors. |
| Points in time | ISO 8601 in UTC with a `Z`: `"2026-11-03T08:00:00Z"`. The frontend shows them in the business time zone, returned as `timeZone` where it matters. |
| Dates | `YYYY-MM-DD`, meaning a calendar day in the business time zone (`settings.timeZone`). |
| Enums | Lower-case strings matching the database: `pending`, `no_show`, `received`. |
| Empty values | Fields with no value are `null`, never left out. |
| Caching | Responses with personal data send `Cache-Control: no-store`. `GET /api/services` may be cached for 60 seconds. |
| Status codes | `200` OK, `201` created, `202` accepted (an email will follow), `204` no content. Errors are listed in [section 2](#2-errors). |

### Shared shapes

**`BookingSummary`**, used by several public responses:

```json
{
  "reference": "BK-000123",
  "status": "pending",
  "paymentStatus": "awaiting_payment",
  "service": { "name": "Soft Glam", "durationMinutes": 90 },
  "startAt": "2026-11-03T08:00:00Z",
  "endAt": "2026-11-03T09:30:00Z",
  "timeZone": "Africa/Johannesburg",
  "price": "650.00",
  "depositAmount": "325.00",
  "depositDueAt": "2026-11-02T08:00:00Z",
  "proofs": [
    { "uploadedAt": "2026-11-01T14:12:00Z", "status": "rejected", "rejectionReason": "Amount does not match" }
  ]
}
```

**`paymentStatus`** is derived for clients (C-6). The first row that matches wins:

| Value | When |
| --- | --- |
| `not_required` | The deposit is 0 |
| `confirmed` | Payment confirmed by the owner (`paymentVerifiedAt` is set), whatever the booking's status now |
| `expired` | The booking expired before payment was confirmed |
| `cancelled` | The booking was cancelled before payment was confirmed |
| `proof_received` | Pending, and at least one proof is `received` or `accepted` (waiting for the owner's bank check) |
| `proof_rejected` | Pending, and every proof so far was rejected; the reasons are in `proofs` |
| `awaiting_payment` | Pending, and no proof has been uploaded |

## 2. Errors

Every error has the same shape:

```json
{
  "statusCode": 409,
  "code": "SLOT_UNAVAILABLE",
  "message": "That time has just been booked. Please choose another time.",
  "details": null
}
```

- `code` is stable and machine-readable; the frontend decides what to show from it.
- `message` is safe to show to the user. It never contains internal details, stack traces or SQL.
- `details` is `null`, except for validation errors, where it lists each problem:

```json
{
  "statusCode": 400,
  "code": "VALIDATION_FAILED",
  "message": "Some details are missing or invalid.",
  "details": [
    { "field": "clientEmail", "message": "Enter a valid email address." },
    { "field": "clientPhone", "message": "Enter a South African phone number." }
  ]
}
```

### Error codes

| Status | Code | Meaning | Returned by |
| --- | --- | --- | --- |
| 400 | `VALIDATION_FAILED` | Missing, malformed or out-of-range input | Any endpoint with input |
| 400 | `SERVICE_UNAVAILABLE` | The service doesn't exist or is inactive (BR-5) | Availability, create booking |
| 400 | `FILE_MISSING` | No file in the `file` field, or more than one file | Proof upload |
| 400 | `FILE_INVALID` | The file is empty or couldn't be read | Proof upload |
| 401 | `UNAUTHENTICATED` | No valid admin session | Every admin endpoint |
| 401 | `INVALID_CREDENTIALS` | Wrong email or password (one message for both) | Login |
| 403 | `FORBIDDEN` | Signed in, but the role isn't allowed | Every admin endpoint |
| 404 | `NOT_FOUND` | No such resource (admin IDs) | Admin endpoints with `:id` |
| 404 | `BOOKING_NOT_FOUND` | Wrong reference or wrong email (one message for both) | Booking lookup |
| 404 | `LINK_NOT_VALID` | The booking link is unknown, was replaced by a newer one, or is no longer active (one message for all three) | Booking link endpoints |
| 409 | `SLOT_UNAVAILABLE` | The time is no longer available: booked by someone else (`bookings_no_overlap`), blocked, outside working hours, not on the slot interval, inside the minimum notice or beyond the advance window | Create booking |
| 409 | `PENDING_LIMIT_REACHED` | The email or phone number already has 2 Pending bookings (BR-11) | Create booking |
| 409 | `BOOKING_NOT_PENDING` | The booking isn't Pending, so proofs can't be uploaded | Proof upload |
| 409 | `PROOF_LIMIT_REACHED` | The booking already has 3 proofs (BR-14) | Proof upload |
| 409 | `INVALID_STATUS_TRANSITION` | The action isn't allowed from the booking's current status (BR-3), including when it changed a moment ago | Admin booking actions |
| 409 | `PROOF_ALREADY_REVIEWED` | The proof was already accepted or rejected | Review proof |
| 409 | `NO_REFUND_DUE` | The booking has no refund due, or it was already recorded | Record refund |
| 409 | `SERVICE_NAME_TAKEN` | Another service already has this name | Create or edit service |
| 410 | `FILE_DELETED` | The proof file was deleted by the 90-day retention rule; its details remain | Proof download |
| 413 | `FILE_TOO_LARGE` | The file is over 5 MB. The upload is stopped as soon as the limit is passed | Proof upload |
| 415 | `UNSUPPORTED_FILE_TYPE` | The file's content isn't PDF, JPEG or PNG, whatever its name says | Proof upload |
| 429 | `RATE_LIMITED` | Too many requests; see `Retry-After` | Rate-limited endpoints |
| 500 | `INTERNAL_ERROR` | Unexpected failure. Logged with a request ID; the message is generic | Any |

### Upload errors (BR-14)

The proof upload returns exactly these codes, as listed in spec section 8:

| Status | Code | Cause |
| --- | --- | --- |
| 400 | `FILE_MISSING`, `FILE_INVALID`, `VALIDATION_FAILED` | No file, several files, an empty file, or a field other than `file` |
| 404 | `LINK_NOT_VALID` | Unknown, replaced or inactive booking link (one message for all) |
| 409 | `BOOKING_NOT_PENDING` | The booking isn't Pending |
| 409 | `PROOF_LIMIT_REACHED` | 3 proofs already uploaded |
| 413 | `FILE_TOO_LARGE` | Over 5 MB |
| 415 | `UNSUPPORTED_FILE_TYPE` | Not PDF, JPEG or PNG by content |
| 429 | `RATE_LIMITED` | Too many uploads for this booking or from this IP address |

### No enumeration

Public endpoints never reveal whether something exists (spec section 9):

- A wrong reference and a wrong email give the identical `404 BOOKING_NOT_FOUND` response, with the same body and similar timing.
- An unknown, replaced or inactive booking link always gives the identical `404 LINK_NOT_VALID`.
- Resending a booking link always answers `202`, whether or not the details matched.
- Login gives one `401 INVALID_CREDENTIALS` for a wrong email or a wrong password.

## 3. Rate limits

Limits are counted per client IP address, and also per booking or per email where that's what needs protecting. When a limit is hit, the API returns `429 RATE_LIMITED` with a `Retry-After` header in seconds. Every rate-limited response includes `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset` headers.

The numbers below are the initial values. They live in configuration so they can be tuned without code changes.

| Endpoint | Limit |
| --- | --- |
| `GET /api/services` | 120 per minute per IP |
| `GET /api/availability` | 60 per minute per IP |
| `POST /api/bookings` | 10 per hour per IP (plus the 2 Pending bookings limit, BR-11) |
| `POST /api/bookings/:reference/lookup` | 10 per 15 minutes per IP |
| `POST /api/bookings/:reference/resend-booking-link` | 3 per hour per booking, and 10 per hour per IP |
| `GET /api/booking/:token` | 30 per minute per IP |
| `POST /api/booking/:token/proofs` | 5 per hour per booking, and 10 per hour per IP |
| `POST /api/booking/:token/cancel` | 5 per hour per IP |
| `POST /api/auth/login` | 5 failed attempts per 15 minutes per IP and email, and 20 per hour per IP |
| Admin endpoints | 300 per minute per session |

---

## 4. Public endpoints

### 4.1 `GET /api/services`

Active services with their deposit amounts (C-1, BR-7). Inactive services are never included (BR-5).

**Response `200`**

```json
{
  "services": [
    {
      "id": "5b0f6c3e-2f4a-4c55-9a43-3c1f5e2f8a10",
      "name": "Soft Glam",
      "description": "Natural, glowing makeup for any occasion.",
      "price": "650.00",
      "durationMinutes": 90,
      "depositAmount": "325.00"
    }
  ],
  "depositPercent": "50.00"
}
```

Services are sorted by name. `depositAmount` is `depositPercent × price`, rounded to cents.

**Errors:** `429`.

### 4.2 `GET /api/availability`

The start times a client can book for a service on a date (C-2, BR-1, BR-6, BR-10, BR-13).

**Query**

| Parameter | Required | Rule |
| --- | --- | --- |
| `serviceId` | Yes | UUID of an active service |
| `date` | Yes | `YYYY-MM-DD` in the business time zone |

**Response `200`**

```json
{
  "serviceId": "5b0f6c3e-2f4a-4c55-9a43-3c1f5e2f8a10",
  "date": "2026-11-03",
  "timeZone": "Africa/Johannesburg",
  "slots": [
    { "startAt": "2026-11-03T07:00:00Z", "endAt": "2026-11-03T08:30:00Z", "localTime": "09:00" },
    { "startAt": "2026-11-03T11:00:00Z", "endAt": "2026-11-03T12:30:00Z", "localTime": "13:00" }
  ]
}
```

`slots` is empty when the day is not a working day, is fully booked or blocked, or falls outside the minimum notice or advance window. `endAt` is the appointment end, without the buffer.

**Errors:** `400 VALIDATION_FAILED` (bad or missing parameter), `400 SERVICE_UNAVAILABLE`, `429`.

### 4.3 `POST /api/bookings`

Create a booking (C-3, C-4, C-5). The server re-checks everything at submission: availability, minimum notice, advance window and booking limits. When a deposit applies the booking is `pending`; when the deposit is 0% it is `confirmed` (BR-3). The booking link is generated and sent **by email only**, never in this response (BR-15).

**Request**

```json
{
  "serviceId": "5b0f6c3e-2f4a-4c55-9a43-3c1f5e2f8a10",
  "startAt": "2026-11-03T07:00:00Z",
  "clientName": "Sarah Mokoena",
  "clientEmail": "sarah@example.com",
  "clientPhone": "082 123 4567",
  "notes": "Birthday makeup"
}
```

| Field | Rule |
| --- | --- |
| `serviceId` | Required. Active service |
| `startAt` | Required. One of the `startAt` values offered by `GET /api/availability` |
| `clientName` | Required. 1 to 100 characters after trimming |
| `clientEmail` | Required. Valid email address, at most 254 characters |
| `clientPhone` | Required. A South African number in any common format; stored in E.164 (`+27821234567`) |
| `notes` | Optional. At most 1,000 characters |

**Response `201`**

```json
{
  "booking": {
    "reference": "BK-000123",
    "status": "pending",
    "service": { "name": "Soft Glam", "durationMinutes": 90 },
    "startAt": "2026-11-03T07:00:00Z",
    "endAt": "2026-11-03T08:30:00Z",
    "timeZone": "Africa/Johannesburg",
    "price": "650.00",
    "depositAmount": "325.00",
    "depositDueAt": "2026-11-02T07:00:00Z"
  },
  "emailSentTo": "sarah@example.com"
}
```

The confirmation page shows this with the message that the booking is confirmed only once the deposit is paid, and the fallback of sending proof by email (C-5). `depositDueAt` is the earlier of the hold duration after booking and the minimum-notice cutoff (BR-9); it is `null` when the booking is `confirmed`.

The emails are sent after the booking is saved. If sending fails, the booking still succeeds (spec section 7).

**Errors:** `400 VALIDATION_FAILED`, `400 SERVICE_UNAVAILABLE`, `409 SLOT_UNAVAILABLE`, `409 PENDING_LIMIT_REACHED`, `429`.

### 4.4 `POST /api/bookings/:reference/lookup`

View a booking with its reference and the email used to book (C-6). It's a `POST` so the email travels in the request body, not the URL (see [section 8](#8-changes-to-the-specification)).

**Request**

```json
{ "email": "sarah@example.com" }
```

The email is compared case-insensitively.

**Response `200`**

```json
{
  "booking": { "...": "BookingSummary" },
  "canResendBookingLink": true
}
```

`booking` is a [`BookingSummary`](#shared-shapes). `canResendBookingLink` is `true` while the booking is Pending or Confirmed and the appointment hasn't started. The booking link itself is never returned.

**Errors:** `400 VALIDATION_FAILED`, `404 BOOKING_NOT_FOUND` (wrong reference or wrong email, identical response), `429`.

### 4.5 `POST /api/bookings/:reference/resend-booking-link`

Issue a new booking link and email it to the booking's email address (C-6, BR-15). The old link stops working immediately.

**Request**

```json
{ "email": "sarah@example.com" }
```

**Response `202`**, always, whether or not the reference and email matched and whether or not the booking can still use a link:

```json
{ "message": "If the details match an active booking, a new booking link has been sent to its email address." }
```

A new link is issued and sent only when the reference and email match a Pending or Confirmed booking whose appointment hasn't started. The email is the payment instructions email while Pending, or the confirmation email once Confirmed.

**Errors:** `400 VALIDATION_FAILED`, `429`.

---

## 5. Booking link endpoints

These endpoints are reached only through the booking link emailed to the client (BR-15). The `:token` is the raw token from the link; the server hashes it with SHA-256 and looks up `bookings.booking_token_hash`.

A link is **active** while the booking is Pending or Confirmed and the appointment hasn't started. Every endpoint here returns the identical `404 LINK_NOT_VALID` for an unknown, replaced or inactive link.

All responses send `Referrer-Policy: no-referrer` and `Cache-Control: no-store`, and request logs replace the token with `***` (spec section 9).

### 5.1 `GET /api/booking/:token`

Data for the booking page (C-7). Opening it never changes the booking.

**Response `200`**

```json
{
  "booking": { "...": "BookingSummary" },
  "bankingDetails": {
    "accountName": "Make Up by Glory",
    "bank": "Example Bank",
    "accountNumber": "1234567890",
    "branchCode": "250655",
    "accountType": "Cheque"
  },
  "canUploadProof": true,
  "proofsRemaining": 2,
  "canCancel": true,
  "cancellation": {
    "refundEligible": false,
    "refundAmount": null,
    "explanation": "Your deposit hasn't been confirmed yet, so no refund will be recorded. If you have already paid, please contact us."
  }
}
```

| Field | Rule |
| --- | --- |
| `bankingDetails` | Present while Pending; `null` once Confirmed |
| `canUploadProof` | `true` while Pending and fewer than 3 proofs exist (BR-14) |
| `proofsRemaining` | `3 −` number of proofs |
| `canCancel` | `true` while the link is active (BR-12) |
| `cancellation.refundEligible` | `true` when the booking is Confirmed, deposits are refundable, and the appointment is at least `refundCutoffHours` away (BR-12). Always `false` while Pending |
| `cancellation.refundAmount` | The amount that would be refunded (the amount received), or `null` |
| `cancellation.explanation` | Plain-language sentence shown before the client confirms |

**Errors:** `404 LINK_NOT_VALID`, `429`.

### 5.2 `POST /api/booking/:token/proofs`

Upload a proof of payment (C-7, BR-14). `multipart/form-data` with a single file in the field `file`.

The server checks, in this order: rate limit, link, Pending status, proof count (under a row lock, so parallel uploads can't pass 3), then streams the file with a 5 MB cap, detects the type from its bytes, computes its SHA-256, saves it under a random key and records it. If saving the record fails, the stored file is deleted. Uploading never changes the booking's status or deadline (BR-3, BR-9). The owner is emailed about every upload.

**Response `201`**

```json
{
  "proof": { "uploadedAt": "2026-11-01T14:12:00Z", "status": "received", "rejectionReason": null },
  "proofsRemaining": 1,
  "message": "Thank you. Your booking will be confirmed once the payment reflects in our account."
}
```

**Errors:** see [Upload errors](#upload-errors-br-14): `400 FILE_MISSING`, `400 FILE_INVALID`, `400 VALIDATION_FAILED`, `404 LINK_NOT_VALID`, `409 BOOKING_NOT_PENDING`, `409 PROOF_LIMIT_REACHED`, `413 FILE_TOO_LARGE`, `415 UNSUPPORTED_FILE_TYPE`, `429`.

### 5.3 `POST /api/booking/:token/cancel`

Cancel the booking (C-8, BR-12). The booking page only sends this after the client has seen the refund explanation and pressed a confirm button; it's a `POST`, so email link scanners can't trigger it.

**Request:** empty body or `{}`.

**Response `200`**

```json
{
  "booking": { "...": "BookingSummary, now with status cancelled" },
  "refundDue": true,
  "refundAmount": "325.00"
}
```

The slot is freed immediately. The client and the owner are emailed; the owner's email says when a refund is due. After cancelling, the link is no longer active.

**Errors:** `404 LINK_NOT_VALID` (including when the appointment has already started, or the booking was already cancelled, completed or expired), `429`.

---

## 6. Authentication

Admin endpoints require a signed-in administrator. Without a valid session they return `401 UNAUTHENTICATED`; with a session whose role isn't allowed they return `403 FORBIDDEN` (A-1). Every admin route is protected by the same guard, and a test generated from the route list checks that none is missed (#79).

Whether the session is a secure HTTP-only cookie or a bearer token is decided in #27. This document is written so that either works; if cookies are chosen, state-changing requests also need CSRF protection.

### 6.1 `POST /api/auth/login`

**Request**

```json
{ "email": "glory@example.com", "password": "correct horse battery staple" }
```

**Response `200`**

```json
{ "user": { "email": "glory@example.com", "role": "admin" } }
```

Plus the session cookie or token, as decided in #27.

**Errors:** `400 VALIDATION_FAILED`, `401 INVALID_CREDENTIALS` (same response for a wrong email or a wrong password), `429`.

### 6.2 `POST /api/auth/logout`

Ends the session. **Response `204`**. **Errors:** `401`.

---

## 7. Admin endpoints

All paths below require authentication ([section 6](#6-authentication)). Each can also return `400 VALIDATION_FAILED`, `401 UNAUTHENTICATED`, `403 FORBIDDEN` and `429 RATE_LIMITED`; only other errors are listed.

### Admin booking shape

**`AdminBooking`**, returned by the list, the detail and every booking action:

```json
{
  "id": "0d6f8a2c-6a1e-4f7e-9a63-5f7c2b1d9e44",
  "reference": "BK-000123",
  "status": "pending",
  "paymentStatus": "proof_received",
  "service": { "id": "5b0f6c3e-2f4a-4c55-9a43-3c1f5e2f8a10", "name": "Soft Glam" },
  "client": { "name": "Sarah Mokoena", "email": "sarah@example.com", "phone": "+27821234567" },
  "startAt": "2026-11-03T07:00:00Z",
  "endAt": "2026-11-03T08:30:00Z",
  "occupiedUntil": "2026-11-03T09:30:00Z",
  "price": "650.00",
  "depositAmount": "325.00",
  "depositDueAt": "2026-11-02T07:00:00Z",
  "amountReceived": null,
  "paymentVerifiedAt": null,
  "paymentVerifiedBy": null,
  "refundDue": false,
  "refundedAt": null,
  "cancelledAt": null,
  "cancelledBy": null,
  "notes": "Birthday makeup",
  "bookingLinkIssuedAt": "2026-11-01T07:00:00Z",
  "proofCount": 1,
  "createdAt": "2026-11-01T07:00:00Z"
}
```

The booking token and its hash are never returned.

### 7.1 `GET /api/admin/dashboard`

Dashboard figures (A-2). Days are counted in the business time zone.

**Response `200`**

```json
{
  "today": 3,
  "upcoming": 12,
  "completedThisMonth": 24,
  "awaitingDeposit": 4,
  "proofsAwaitingReview": 2,
  "refundsDue": 1,
  "upcomingAppointments": [
    {
      "id": "0d6f8a2c-6a1e-4f7e-9a63-5f7c2b1d9e44",
      "reference": "BK-000123",
      "clientName": "Sarah Mokoena",
      "serviceName": "Soft Glam",
      "startAt": "2026-11-03T07:00:00Z",
      "status": "confirmed"
    }
  ]
}
```

| Figure | Counts |
| --- | --- |
| `today` | Pending and Confirmed bookings starting today |
| `upcoming` | Pending and Confirmed bookings starting after now |
| `completedThisMonth` | Bookings marked Completed with a start in the current month |
| `awaitingDeposit` | Pending bookings |
| `proofsAwaitingReview` | Proofs with status `received` |
| `refundsDue` | Bookings with `refundDue` and no `refundedAt` |
| `upcomingAppointments` | The next 10 Pending and Confirmed bookings |

### 7.2 `GET /api/admin/bookings`

List and filter bookings (A-3).

**Query**

| Parameter | Rule |
| --- | --- |
| `status` | Optional. One or more statuses, comma-separated: `pending,confirmed` |
| `from`, `to` | Optional. `YYYY-MM-DD`; bookings starting on or after `from` and on or before `to` |
| `proof` | Optional. `received` returns only bookings with a proof awaiting review |
| `q` | Optional. Matches the reference, or part of the client's name, email or phone |
| `sort` | Optional. `startAt` (default) or `-startAt` for newest first, or `createdAt` / `-createdAt` |
| `page`, `pageSize` | Optional. Defaults 1 and 25; `pageSize` at most 100 |

**Response `200`**

```json
{
  "items": [ { "...": "AdminBooking" } ],
  "page": 1,
  "pageSize": 25,
  "total": 87
}
```

### 7.3 `GET /api/admin/bookings/:id`

One booking with its proofs (A-3).

**Response `200`**

```json
{
  "booking": { "...": "AdminBooking" },
  "proofs": [
    {
      "id": "8c2d1f4e-9b3a-4d6e-8f1a-2b3c4d5e6f70",
      "originalFilename": "proof-of-payment.pdf",
      "contentType": "application/pdf",
      "sizeBytes": 120394,
      "sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      "usedOnOtherBookings": ["BK-000098"],
      "status": "received",
      "rejectionReason": null,
      "uploadedAt": "2026-11-01T14:12:00Z",
      "uploadedFromIp": "196.25.1.1",
      "reviewedAt": null,
      "reviewedBy": null,
      "fileDeletedAt": null
    }
  ],
  "notifications": [
    { "type": "payment_instructions", "recipient": "sarah@example.com", "status": "sent", "sentAt": "2026-11-01T07:00:05Z", "error": null }
  ]
}
```

`usedOnOtherBookings` lists other bookings that have a proof with the same SHA-256, so the owner can spot a reused proof.

**Errors:** `404 NOT_FOUND`.

### 7.4 `POST /api/admin/bookings/:id/confirm-payment`

Record the amount received and confirm the booking, after the owner has seen the money in her bank account (A-4, BR-8). Records who confirmed and when. Goes through the `PaymentProvider` interface (manual EFT in v1). The client is emailed a confirmation.

**Request**

```json
{ "amountReceived": "325.00" }
```

`amountReceived` must be more than `"0.00"`. If it is less than the deposit, the portal warns before sending, but the owner decides.

**Response `200`**: `{ "booking": AdminBooking }` with status `confirmed`.

**Errors:** `404 NOT_FOUND`, `409 INVALID_STATUS_TRANSITION` (not Pending, for example it has just expired).

### 7.5 `PATCH /api/admin/bookings/:id/deadline`

Extend the deposit deadline of a Pending booking (A-4, BR-9).

**Request**

```json
{ "depositDueAt": "2026-11-02T15:00:00Z" }
```

`depositDueAt` must be in the future and before the appointment starts.

**Response `200`**: `{ "booking": AdminBooking }`.

**Errors:** `404 NOT_FOUND`, `409 INVALID_STATUS_TRANSITION` (not Pending).

### 7.6 `PATCH /api/admin/bookings/:id/status`

Cancel, complete or mark a no-show (A-4, BR-3).

**Request**

```json
{ "status": "cancelled", "refundDue": true }
```

| `status` | Allowed from | Notes |
| --- | --- | --- |
| `cancelled` | Pending, Confirmed | Frees the slot; the client is emailed. `refundDue` is required when the booking is Confirmed (the owner decides whether she owes a refund when she cancels) and not allowed otherwise |
| `completed` | Confirmed, once the appointment has started | |
| `no_show` | Confirmed, once the appointment has started | |

**Response `200`**: `{ "booking": AdminBooking }`.

**Errors:** `404 NOT_FOUND`, `409 INVALID_STATUS_TRANSITION`.

### 7.7 `POST /api/admin/bookings/:id/refund`

Record that a refund due has been paid (BR-12). Sets `refundedAt`.

**Request:** empty body or `{}`. **Response `200`**: `{ "booking": AdminBooking }`.

**Errors:** `404 NOT_FOUND`, `409 NO_REFUND_DUE` (no refund due, or already recorded).

### 7.8 `POST /api/admin/bookings/:id/booking-link`

Issue a new booking link and email it to the client (BR-15). The old link stops working immediately.

**Request:** empty body or `{}`. **Response `202`**:

```json
{ "bookingLinkIssuedAt": "2026-11-01T16:40:00Z", "emailSentTo": "sarah@example.com" }
```

**Errors:** `404 NOT_FOUND`, `409 INVALID_STATUS_TRANSITION` (not Pending or Confirmed, or the appointment has started).

### 7.9 `GET /api/admin/payment-proofs/:id/file`

Stream a proof file (A-9).

**Query:** `download=true` forces a download; otherwise PDF and images are shown inline.

**Response `200`**: the file, with:

- `Content-Type`: the type detected at upload (`application/pdf`, `image/jpeg` or `image/png`)
- `Content-Disposition`: `inline` or `attachment`, with a safe filename built from the booking reference (`BK-000123-proof-1.pdf`), never the uploaded filename
- `X-Content-Type-Options: nosniff`
- `Cache-Control: no-store`

**Errors:** `404 NOT_FOUND`, `410 FILE_DELETED` (removed by the 90-day retention rule).

### 7.10 `PATCH /api/admin/payment-proofs/:id`

Accept or reject a proof (A-9). Records who reviewed it and when. Accepting doesn't confirm the booking; that's a separate step after the bank check ([7.4](#74-post-apiadminbookingsidconfirm-payment)). Rejecting emails the client the reason, without a booking link (BR-14).

**Request**

```json
{ "status": "rejected", "rejectionReason": "The amount does not match the deposit." }
```

| Field | Rule |
| --- | --- |
| `status` | `accepted` or `rejected` |
| `rejectionReason` | Required when rejecting, 1 to 500 characters, shown to the client. Not allowed when accepting |

**Response `200`**: the proof, in the shape used by [7.3](#73-get-apiadminbookingsid).

**Errors:** `404 NOT_FOUND`, `409 PROOF_ALREADY_REVIEWED`.

### 7.11 `GET /api/admin/calendar`

Appointments for the FullCalendar view (A-7).

**Query**

| Parameter | Rule |
| --- | --- |
| `from`, `to` | Required. `YYYY-MM-DD`, at most 62 days apart |
| `includeCancelled` | Optional. `true` also returns Cancelled and Expired bookings |

**Response `200`**

```json
{
  "timeZone": "Africa/Johannesburg",
  "events": [
    {
      "id": "0d6f8a2c-6a1e-4f7e-9a63-5f7c2b1d9e44",
      "reference": "BK-000123",
      "title": "Soft Glam · Sarah Mokoena",
      "start": "2026-11-03T07:00:00Z",
      "end": "2026-11-03T08:30:00Z",
      "status": "pending"
    }
  ],
  "blockedTimes": [
    { "id": "2a7e1c3b-4d5f-4a6b-8c9d-0e1f2a3b4c5d", "start": "2026-11-05T22:00:00Z", "end": "2026-11-06T22:00:00Z", "reason": "Wedding trial" }
  ]
}
```

By default, events are Pending, Confirmed, Completed and No-show bookings. The portal colours them by `status`.

### 7.12 Services

Manage services (A-5).

| Endpoint | Request | Response |
| --- | --- | --- |
| `GET /api/admin/services` | Query `includeInactive` (default `true`) | `200 { "services": [Service] }`, sorted by name |
| `POST /api/admin/services` | `{ "name", "description", "price", "durationMinutes", "isActive" }` | `201 { "service": Service }` |
| `PATCH /api/admin/services/:id` | Any of the same fields | `200 { "service": Service }` |
| `DELETE /api/admin/services/:id` | — | `204` if the service had no bookings and was deleted; `200 { "service": Service, "deactivated": true }` if it has bookings and was deactivated instead |

**`Service`**: `{ "id", "name", "description", "price", "durationMinutes", "isActive", "bookingCount", "createdAt", "updatedAt" }`.

| Field | Rule |
| --- | --- |
| `name` | Required on create. 1 to 100 characters, unique (case-insensitive) |
| `description` | Optional. At most 2,000 characters |
| `price` | Required on create. `"0.00"` or more |
| `durationMinutes` | Required on create. 1 to 720 |
| `isActive` | Optional. Default `true` |

Editing a service never changes existing bookings, which keep their own price and duration (BR-4).

**Errors:** `404 NOT_FOUND`, `409 SERVICE_NAME_TAKEN`.

### 7.13 Availability

Working hours (A-6), one entry per day of the week (1 = Monday … 7 = Sunday).

**`GET /api/admin/availability`** → `200`:

```json
{
  "timeZone": "Africa/Johannesburg",
  "days": [
    { "dayOfWeek": 1, "isWorkingDay": true, "startTime": "09:00", "endTime": "17:00" },
    { "dayOfWeek": 7, "isWorkingDay": false, "startTime": null, "endTime": null }
  ]
}
```

**`PUT /api/admin/availability`** replaces the whole week. The request is `{ "days": [...] }` with exactly seven entries, one per day. Working days need `startTime` before `endTime` (`HH:mm`); non-working days have both `null`. Response `200` with the saved week.

Changes apply to the slots offered from then on. Existing bookings are not affected.

### 7.14 Blocked times

Block whole dates or time ranges (A-6).

| Endpoint | Request | Response |
| --- | --- | --- |
| `GET /api/admin/blocked-times` | Query `from`, `to` (`YYYY-MM-DD`, optional; default from today) | `200 { "blockedTimes": [BlockedTime] }` |
| `POST /api/admin/blocked-times` | `{ "startAt", "endAt", "reason" }` | `201 { "blockedTime": BlockedTime, "overlappingBookings": ["BK-000123"] }` |
| `DELETE /api/admin/blocked-times/:id` | — | `204` |

**`BlockedTime`**: `{ "id", "startAt", "endAt", "reason", "createdAt" }`. `endAt` must be after `startAt`. To block a whole day, the portal sends midnight to midnight in the business time zone, converted to UTC.

Blocking time that overlaps existing Pending or Confirmed bookings is allowed; those bookings are not cancelled, and `overlappingBookings` lists them so the owner can decide what to do.

**Errors:** `404 NOT_FOUND` (delete).

### 7.15 Settings

All settings in A-8.

**`GET /api/admin/settings`** → `200`:

```json
{
  "settings": {
    "minNoticeHours": 24,
    "maxAdvanceDays": 90,
    "slotIntervalMinutes": 120,
    "bufferMinutes": 60,
    "depositPercent": "50.00",
    "depositRefundable": true,
    "refundCutoffHours": 24,
    "depositHoldHours": 24,
    "timeZone": "Africa/Johannesburg",
    "bankingDetails": {
      "accountName": "Make Up by Glory",
      "bank": "Example Bank",
      "accountNumber": "1234567890",
      "branchCode": "250655",
      "accountType": "Cheque"
    },
    "updatedAt": "2026-10-10T08:00:00Z"
  }
}
```

**`PATCH /api/admin/settings`** accepts any subset of the fields and returns the full settings.

| Field | Rule |
| --- | --- |
| `minNoticeHours` | 0 to 720 |
| `maxAdvanceDays` | 1 to 365 |
| `slotIntervalMinutes` | 5 to 720, a multiple of 5 |
| `bufferMinutes` | 0 to 240 |
| `depositPercent` | `"0.00"` to `"100.00"` |
| `depositRefundable` | Boolean |
| `refundCutoffHours` | 0 to 720 |
| `depositHoldHours` | 1 to 168 |
| `timeZone` | A valid IANA time zone name |
| `bankingDetails` | All five fields required, each 1 to 100 characters |

New settings apply to new bookings and future slot calculations only. Existing bookings keep their price, deposit, deadline and occupied time.

---

## 8. Changes to the specification

Writing this document settled some details that spec section 8 left open. Section 8 has been updated to match.

| Change | Why |
| --- | --- |
| All endpoints are under `/api` | The booking link `/booking/<token>` is a page. The API needs a different path for the same booking, so pages and API never clash. |
| `GET /bookings/:reference` became `POST /api/bookings/:reference/lookup`, with the email in the body | A `GET` would put the client's email in the URL, where it lands in server logs, browser history and proxies. The privacy rules (spec section 9) forbid that. |
| Paths with IDs spelled out: `PATCH`/`DELETE /api/admin/services/:id`, `DELETE /api/admin/blocked-times/:id` | Section 8 grouped them without the `:id`. |
| Added `GET /api/admin/services` | The portal must list inactive services too; `GET /api/services` only returns active ones. |
| Added `POST /api/auth/logout` | The portal needs a way to sign out. |
| Admin cancellation of a Confirmed booking takes `refundDue` | BR-12 only defines the refund rule for client cancellations. When the owner cancels, she decides whether a refund is owed. |
| Added `410 FILE_DELETED` for proof downloads | Proof files are deleted after 90 days (BR-14) while their records remain. |
