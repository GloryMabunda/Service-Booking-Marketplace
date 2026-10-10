# Email Content

*Make Up by Glory · approved wording for every email in [Specification v1.0](specification.md), section 7 (#13)*

The subject, preview text and body of each email the system sends. The notifications module (#54 to #61, #71, #72, #73) renders these templates; the `type` names match `notification_type` in [`database.md`](database.md).

## Contents

1. [Conventions](#1-conventions)
2. [Variables](#2-variables)
3. [Shared pieces](#3-shared-pieces)
4. [Client emails](#4-client-emails)
5. [Owner emails](#5-owner-emails)
6. [Which email when](#6-which-email-when)

---

## 1. Conventions

| Topic | Rule |
| --- | --- |
| Voice | Warm, clear and personal, in the first person as Glory ("I'll see you on Tuesday"). Short sentences, no jargon. Owner emails are brief and factual. |
| Sender | From: `{{business.name}} <bookings address>`. Reply-To: `{{business.email}}`, so a client's reply reaches the owner. |
| Format | HTML following the [style guide](style-guide.md) (logo, white background, magenta links, orange button for the main action), with a plain-text version of the same words. Width at most 600 px; readable on a phone. |
| Dates and times | Business time zone, written out: "Tuesday 13 October 2026 at 09:00". Times as `HH:mm`. Money as "R325" or "R1,200" (no cents unless there are cents). |
| Booking link | Appears **only** in an email sent at the moment the link is created: payment instructions, the no-deposit confirmation, and a resent link (BR-15). Only the link's hash is stored, so later emails can't include it; they point to the booking details page instead. The link is never shown in owner emails, logs or the notification history. |
| Personal data | Only what the recipient needs (POPIA). Client emails never show other clients' details; owner emails show the client's name, email and phone. |
| Transactional only | These are service emails about a booking the client made, so they carry no marketing and need no unsubscribe link. |
| Failure | A failed send is recorded on the notification and never blocks the booking (spec section 7). |

## 2. Variables

Placeholders use `{{double braces}}`; the templating library is chosen in #55.

| Variable | Example | Source |
| --- | --- | --- |
| `{{business.name}}` | Make Up by Glory | Settings |
| `{{business.email}}` | bookings@example.com | Settings |
| `{{business.phone}}` | 082 123 4567 | Settings (optional; lines using it are left out when empty) |
| `{{client.firstName}}` | Sarah | First word of the client's name |
| `{{client.name}}`, `{{client.email}}`, `{{client.phone}}` | Sarah Mokoena · sarah@example.com · 082 123 4567 | Booking |
| `{{booking.reference}}` | BK-000123 | Booking |
| `{{booking.service}}` | Soft Glam | Service name at booking time |
| `{{booking.when}}` | Tuesday 13 October 2026 at 09:00 | Booking start, business time zone |
| `{{booking.endTime}}` | 10:30 | Booking end |
| `{{booking.price}}` | R650 | Price at booking |
| `{{booking.deposit}}` | R325 | Deposit amount |
| `{{booking.balance}}` | R325 | Price minus deposit, paid on the day |
| `{{booking.deadline}}` | Sunday 11 October 2026 at 14:00 | Deposit deadline |
| `{{booking.notes}}` | Birthday makeup | Client's notes (owner emails only) |
| `{{booking.previousStatus}}` | Confirmed | Status just before a cancellation (owner emails only) |
| `{{booking.link}}` | https://…/booking/… | The booking link, only where allowed (section 1) |
| `{{bank.accountName}}`, `{{bank.bank}}`, `{{bank.accountNumber}}`, `{{bank.branchCode}}`, `{{bank.accountType}}` | Make Up by Glory · Example Bank · 1234567890 · 250655 · Cheque | Settings |
| `{{refund.cutoff}}` | Monday 12 October 2026 at 09:00 | Booking start minus the refund cut-off |
| `{{refund.cutoffHours}}` | 24 | Settings: refund cut-off in hours |
| `{{refund.amount}}` | R325 | Amount received |
| `{{payment.amountReceived}}` | R325 | Recorded by the owner |
| `{{proof.reason}}` | The amount does not match the deposit. | Owner's rejection reason |
| `{{proof.uploadedAt}}` | Saturday 10 October 2026 at 15:40 | Upload time |
| `{{proof.count}}` | 2 of 3 | Proofs uploaded so far |
| `{{site.homeUrl}}`, `{{site.bookUrl}}`, `{{site.lookupUrl}}` | https://… | Home, services list, booking details page |
| `{{portal.bookingUrl}}` | https://…/admin/bookings/… | Owner's portal page for the booking |

## 3. Shared pieces

**Booking summary** (used in most client emails):

```text
Booking reference: {{booking.reference}}
Service: {{booking.service}}
When: {{booking.when}} (until {{booking.endTime}})
Price: {{booking.price}}
```

**Client footer:**

```text
{{business.name}}
{{business.email}} · {{business.phone}}

Questions? Just reply to this email.
You're receiving this because you made a booking with {{business.name}}.
```

**Owner footer:** "Sent by your booking system. Manage this booking in the portal: {{portal.bookingUrl}}"

---

## 4. Client emails

### 4.1 Payment instructions · `payment_instructions`

**When:** a booking is created with a deposit (status Pending). Also sent, with the "new link" variant, when a new booking link is issued while the booking is Pending (C-6, BR-15).
**To:** the client.

**Subject:** Your booking request {{booking.reference}}: please pay your deposit
**Preview text:** Pay {{booking.deposit}} by {{booking.deadline}} to confirm your {{booking.service}} appointment.

```text
Hi {{client.firstName}},

Thank you for booking with {{business.name}}! I've reserved this time for you:

[Booking summary]

Your booking is not confirmed yet. It's confirmed only once your deposit
reflects in my bank account.

1. Pay your deposit of {{booking.deposit}} by {{booking.deadline}}

   Account name:    {{bank.accountName}}
   Bank:            {{bank.bank}}
   Account number:  {{bank.accountNumber}}
   Branch code:     {{bank.branchCode}}
   Account type:    {{bank.accountType}}
   Reference:       {{booking.reference}}

   Please use {{booking.reference}} as your payment reference so I can match
   your payment.

2. Upload your proof of payment

   [Button: Upload proof of payment] → {{booking.link}}

   This is your private booking link. Keep this email: you can also use the
   link to cancel if your plans change. Please don't share it.

3. I'll confirm your booking by email as soon as the money reflects in my
   account.

If the deposit isn't received by {{booking.deadline}}, the booking expires and
the time is released for other clients.

The balance of {{booking.balance}} is payable on the day.

Can't use the upload button? Email your proof of payment to
{{business.email}} with your reference {{booking.reference}}.

See you soon,
Glory

[Client footer]
```

**Variant: new link** (subject "Your new booking link for {{booking.reference}}"): the first paragraph becomes "As requested, here's a new private link for your booking. Your previous link no longer works." The rest is unchanged.

**Notes:** The sentence "Your booking is not confirmed yet. It's confirmed only once your deposit reflects in my bank account." is required (C-5) and must stay prominent, directly under the summary.

### 4.2 Booking confirmed · `booking_confirmed`

Two variants share the type.

#### a) Payment confirmed

**When:** the owner confirms payment (A-4, BR-8).
**To:** the client.

**Subject:** You're booked! {{booking.service}} on {{booking.when}}
**Preview text:** Your deposit of {{payment.amountReceived}} has been received.

```text
Hi {{client.firstName}},

Good news: your deposit of {{payment.amountReceived}} has been received and
your booking is confirmed.

[Booking summary]

The balance of {{booking.balance}} is payable on the day.

Need to cancel? Cancel at least {{refund.cutoffHours}} hours before your
appointment (by {{refund.cutoff}}) and your deposit will be refunded. Use the booking link in
your payment instructions email, or get a new link from your booking details
page: {{site.lookupUrl}}

I'm looking forward to seeing you!
Glory

[Client footer]
```

**Notes:** No booking link here: it can't be retrieved after it's created (section 1). The refund sentence follows the settings: when deposits aren't refundable it reads "Please note that deposits aren't refundable." and the cut-off text is left out; when the cut-off has already passed it reads "Cancelling now won't refund your deposit."

#### b) No deposit needed

**When:** a booking is created while the deposit is 0% (BR-3), or a new link is issued for a Confirmed booking.
**To:** the client.

**Subject:** You're booked! {{booking.service}} on {{booking.when}}
**Preview text:** Your booking {{booking.reference}} is confirmed.

```text
Hi {{client.firstName}},

Thank you for booking with {{business.name}}! Your booking is confirmed.

[Booking summary]

Your private booking link lets you see your booking and cancel if your plans
change:

[Button: View my booking] → {{booking.link}}

Please keep this email and don't share the link.

See you soon,
Glory

[Client footer]
```

**Variant: new link** (subject "Your new booking link for {{booking.reference}}"): the first paragraph becomes "As requested, here's a new private link for your booking. Your previous link no longer works."

### 4.3 Proof of payment not accepted · `proof_rejected`

**When:** the owner rejects a proof (A-9, BR-14).
**To:** the client.

**Subject:** Please check your proof of payment for {{booking.reference}}
**Preview text:** I couldn't accept the proof you sent. Here's why.

```text
Hi {{client.firstName}},

Thank you for sending your proof of payment for {{booking.service}} on
{{booking.when}}. Unfortunately I couldn't accept it:

  "{{proof.reason}}"

Please upload a new proof of payment using the booking link in your payment
instructions email. If you can't find it, request a new link from your
booking details page: {{site.lookupUrl}}

Your deposit of {{booking.deposit}} is still due by {{booking.deadline}}.
If it isn't received by then, the booking expires.

If you think this is a mistake, just reply to this email.

Thank you,
Glory

[Client footer]
```

**Notes:** Never includes a booking link (BR-14). The reason is the owner's text, shown exactly as written.

### 4.4 Booking cancelled · `booking_cancelled`

**When:** the client cancels through the booking link (C-8), or the owner cancels from the portal (A-4).
**To:** the client.

**Subject:** Your booking {{booking.reference}} has been cancelled
**Preview text:** {{booking.service}} on {{booking.when}} is cancelled.

```text
Hi {{client.firstName}},

[Opening, see variants]

Cancelled booking:
[Booking summary]

[Refund line, see variants]

You're welcome to book again any time: {{site.bookUrl}}

Glory

[Client footer]
```

**Opening variants:**

| Cancelled by | Opening |
| --- | --- |
| Client | "As requested, your booking has been cancelled and the time released." |
| Owner | "I'm sorry, but I've had to cancel your booking. Please reply to this email if you'd like to arrange another time." |

**Refund line variants:**

| Situation | Refund line |
| --- | --- |
| Refund due (Confirmed, cancelled within the refund rule, or the owner marked a refund due) | "Your deposit of {{refund.amount}} will be refunded. I'll be in touch to arrange it." |
| Confirmed, outside the refund rule | "As this was within {{refund.cutoffHours}} hours of your appointment, your deposit isn't refundable." |
| Confirmed, owner cancelled with no refund due | Left out; the owner explains personally. |
| Pending (no deposit confirmed) | "No deposit had been confirmed for this booking. If you've already paid, please reply to this email and I'll sort it out." |
| No deposit applied | Left out. |

### 4.5 Booking expired · `booking_expired`

**When:** the expiry job expires a Pending booking whose deadline passed (BR-9).
**To:** the client.

**Subject:** Your booking request {{booking.reference}} has expired
**Preview text:** The deposit wasn't received in time, so the time has been released.

```text
Hi {{client.firstName}},

I didn't receive your deposit for {{booking.service}} on {{booking.when}}
by {{booking.deadline}}, so the booking has expired and the time has been
released.

If you've already paid, please reply to this email with your proof of payment
and I'll sort it out.

You're welcome to book again: {{site.bookUrl}}

Glory

[Client footer]
```

---

## 5. Owner emails

Sent to `{{business.email}}`. Short, scannable, with a button to the booking in the portal.

### 5.1 New booking · `admin_new_booking`

**When:** any booking is created.

**Subject:** New booking: {{client.name}}, {{booking.service}}, {{booking.when}}
**Preview text:** {{booking.reference}} · deposit {{booking.deposit}} due {{booking.deadline}}

```text
New booking {{booking.reference}}

Client:   {{client.name}}
Email:    {{client.email}}
Phone:    {{client.phone}}
Service:  {{booking.service}}
When:     {{booking.when}} (until {{booking.endTime}})
Price:    {{booking.price}}
Deposit:  {{booking.deposit}}, due by {{booking.deadline}}
Status:   Pending (awaiting deposit)
Notes:    {{booking.notes}}

[Button: Open booking] → {{portal.bookingUrl}}

[Owner footer]
```

**Variant: no deposit** — the Deposit line is left out and Status reads "Confirmed (no deposit)". The Notes line is left out when empty.

### 5.2 New proof of payment · `admin_proof_uploaded`

**When:** a client uploads a proof (BR-14).

**Subject:** Proof of payment uploaded: {{booking.reference}}, {{client.name}}
**Preview text:** Check your bank for {{booking.deposit}} before confirming.

```text
{{client.name}} uploaded a proof of payment for {{booking.reference}}.

Service:   {{booking.service}}, {{booking.when}}
Deposit:   {{booking.deposit}}
Deadline:  {{booking.deadline}}
Uploaded:  {{proof.uploadedAt}} ({{proof.count}})

Before confirming, check that {{booking.deposit}} has reflected in your bank
account. A proof of payment alone isn't enough: proofs can be faked and
payments reversed.

[Button: Review proof] → {{portal.bookingUrl}}

The booking still expires at the deadline unless you confirm payment or
extend the deadline.

[Owner footer]
```

### 5.3 Client cancellation · `admin_client_cancelled`

**When:** a client cancels through the booking link (C-8, BR-12).

**Subject (refund due):** Refund due: {{client.name}} cancelled {{booking.reference}}
**Subject (no refund due):** Cancelled: {{client.name}}, {{booking.reference}}
**Preview text:** {{booking.service}} on {{booking.when}} is cancelled; the time is free again.

```text
{{client.name}} cancelled their booking {{booking.reference}}.

Service:  {{booking.service}}, {{booking.when}}
Status before cancelling: {{booking.previousStatus}}
Client:   {{client.email}} · {{client.phone}}

[Refund block, see variants]

The time has been released for other bookings.

[Button: Open booking] → {{portal.bookingUrl}}

[Owner footer]
```

**Refund block variants:**

| Situation | Block |
| --- | --- |
| Refund due | "**Refund due: {{refund.amount}}.** They cancelled before the refund cut-off. Pay the refund, then record it in the portal (Record refund paid)." |
| Confirmed, outside the refund rule | "No refund is due: they cancelled after the refund cut-off." |
| Pending | "No deposit had been confirmed. If they had already paid, check your bank and refund them manually." |

---

## 6. Which email when

| Event | Client email | Owner email |
| --- | --- | --- |
| Booking created, deposit applies | 4.1 Payment instructions | 5.1 New booking |
| Booking created, no deposit | 4.2b Booking confirmed (no deposit) | 5.1 New booking (no deposit variant) |
| New booking link requested or issued, Pending | 4.1 Payment instructions, new link variant | — |
| New booking link requested or issued, Confirmed | 4.2b Booking confirmed, new link variant | — |
| Proof uploaded | — | 5.2 New proof of payment |
| Proof rejected | 4.3 Proof not accepted | — |
| Proof accepted | — (accepting doesn't confirm the booking) | — |
| Payment confirmed | 4.2a Booking confirmed | — |
| Deadline extended | — | — |
| Client cancels | 4.4 Booking cancelled (client variant) | 5.3 Client cancellation |
| Owner cancels | 4.4 Booking cancelled (owner variant) | — |
| Booking expires | 4.5 Booking expired | — |
| Marked completed or no-show | — | — |
