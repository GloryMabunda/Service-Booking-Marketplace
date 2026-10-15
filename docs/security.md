# Security and privacy (POPIA) review

*Service Booking System · written for issue #85 · reviewed 14 October 2026 · applies to version 1.0*

This document says what personal data the system keeps and why, how long it is kept, who can see it, what protects it, and what is still undecided. It is written for the owner of the business, who is the **responsible party** under POPIA (the Protection of Personal Information Act), and for whoever maintains the system.

> **This is a technical review, not legal advice.** POPIA has duties the software cannot meet on its own (a privacy notice, registering an information officer, dealing with requests, reporting a breach). Section 7 lists them. Have an adviser check them before the site takes real bookings.

## Contents

1. [In one page](#1-in-one-page)
2. [What personal data is kept](#2-what-personal-data-is-kept)
3. [How long it is kept](#3-how-long-it-is-kept)
4. [What protects it](#4-what-protects-it)
5. [Secrets](#5-secrets)
6. [Logs](#6-logs)
7. [What you must still do](#7-what-you-must-still-do)
8. [Decisions waiting for the owner](#8-decisions-waiting-for-the-owner)
9. [The review: what was checked and what was found](#9-the-review-what-was-checked-and-what-was-found)

---

## 1. In one page

- The system keeps what a booking needs: a client's **name, email, phone number and any note**, the appointment, and the **proof of payment** they send. Proofs can show a bank account, so they get the strongest protection.
- **Only you can see client details**, by signing in to the admin portal. A client can see only their own booking, through the private link in their email or with their reference and email.
- Proof-of-payment **files are deleted 90 days after a booking is finished**. The system **never asks for or stores a client's bank details** for refunds: you ask them yourself when a refund is due.
- Website photos have **all hidden data removed** (location, camera, date) and are shown only after you confirm you may show the people in them.
- **No secrets are in the code.** Passwords are stored only as Argon2id hashes. Booking links and sessions are stored only as hashes.
- Every protection listed here has an automated test that fails if it stops working.

## 2. What personal data is kept

| Whose | What | Where it is stored | Why | Who can see it |
| --- | --- | --- | --- | --- |
| **Clients** | Name, email address, phone number (as +27…) | `bookings` | To make and manage the appointment and contact the client about it | You (portal). The client sees their own booking only |
| Clients | **The address of an appointment at their place**, and the distance and travel fee worked out from it | `bookings` (`appointment_address`, `travel_*`) | So you can find the client and charge the travel fee (BR-17, #115) | You (portal), the client on their own booking page, and in their booking emails. Never on the public site, never in a log |
| Clients | Notes typed on the booking form (optional) | `bookings.notes` | So you know what they asked for | You |
| Clients | Appointment time, service, price, deposit, status, who cancelled and when | `bookings` | The booking itself, and to work out refunds | You. The client sees their own |
| Clients | **Proof of payment** (a PDF or image they upload) | The private storage area (`uploads/private`) | To check a deposit before you confirm a booking | You only, and only while signed in |
| Clients | The proof's file name as sent, its type, size, **SHA-256 fingerprint** and the **IP address it was uploaded from** | `payment_proofs` | The name and fingerprint help you spot the same proof used for two bookings; the IP address is for investigating abuse | You |
| Clients | Which emails were sent to them, when, and any error from the mail provider (not the email's text) | `notifications` | To show you what was sent and why one failed | You |
| Clients | **Never stored:** bank account details for refunds, ID numbers, card numbers, date of birth | n/a | The system doesn't ask for them (decision #116) | n/a |
| **The owner** | Email address and an **Argon2id hash** of the password (never the password) | `users` | To sign in | You |
| The owner | A session: a SHA-256 hash of the sign-in cookie, when it was made and last used | `sessions` | To keep you signed in (12 hours idle, 7 days at most) | The system only |
| **People in website photos** | The photos, and **who confirmed permission and when** | `images`, `gallery_items` | To show your work, with consent (BR-16) | Everyone, once you publish them. You can delete any photo at any time |
| People quoted | A first name or initial and a quote you entered | `testimonials` | To show kind words, with permission | Everyone, once shown |
| **The owner** | Her **home address**, as the starting point for travel distances | `settings.home_address` | To work out travel fees (BR-17) | You. A client who comes to your place is given it in their booking emails and on their private booking page. It is not on the public site or in any public answer |
| **The business** | Its bank account details | `settings` | To tell clients where to pay a deposit | Shown to a client in their payment email and on their booking page while a deposit is due |

**Others who handle the data:**

| Who | What they receive | Notes |
| --- | --- | --- |
| Your **email provider** (SMTP) | Every email the system sends: the client's address, the booking details, your bank details and the booking link | Choose a provider that sends over an encrypted connection and sign its data-processing terms |
| Your **hosting provider** | Everything, as the place the system runs | Decided in M8. Prefer a South African or EU region |
| **OpenRouteService** (HeiGIT, Germany) | The home address and the client's appointment address, when a client asks for the travel fee, so it can find them on a map and measure the road distance. No name, email or phone is sent | Used only when a client chooses "at your place". Answers are remembered for a day. See `docs/travel.md` |
| **Google Fonts** (`fonts.googleapis.com`) | The visitor's IP address, when a page loads | See decision D2 |
| **jsDelivr** (`cdn.jsdelivr.net`) | The visitor's IP address, when a page loads Bootstrap | Every file is checked against an integrity hash, so the CDN can't change it |

The private booking page sends **no referrer** and runs **no outside scripts**, so the secret in its address is never given to those hosts.

## 3. How long it is kept

| Data | Kept for | Done by |
| --- | --- | --- |
| Proof-of-payment **files** | **90 days** after the booking is Completed, No-show, Cancelled or Expired | A daily job (#77). A fixed rule: it can't be changed from the portal |
| Proof **records** (name, type, size, fingerprint, IP, review) | Not deleted in v1 | See decision D1 |
| Files with no record (an upload that stopped half way) | Removed after 1 hour | The same daily job |
| Bookings, client details and notification records | **Not deleted in v1** | See decision D1 |
| Sessions | 12 hours idle, 7 days at most; ended sessions are deleted | Automatic |
| Booking links | Work only while the booking is Pending or Confirmed and the appointment has not started; replaced when a new one is made | Automatic |
| Website photos and testimonials | Until you delete them | You |
| Logs | The hosting provider's log retention (set in M8) | Hosting |

## 4. What protects it

Each protection is tested. The test files are named so a change that breaks one fails the build.

| Protection | Where it is tested |
| --- | --- |
| **Only a signed-in administrator** can use any `/api/admin` route. The list of routes is read from the running app, so a new route is covered automatically. A visitor, a forged, expired or signed-out session, and a request started by another website are all refused | `tests/security/admin-authorization.spec.ts` |
| 300 requests a minute per admin session; sign-in is limited to 5 failed tries per 15 minutes per address and email | `admin-authorization`, `tests/api/auth.spec.ts` |
| **Passwords** are hashed with Argon2id, at least 12 characters, never logged | `src/auth/password.spec.ts`, `log-masking` |
| Session cookie is `HttpOnly` and `SameSite=Strict` (and `Secure` in production); only its hash is stored | `admin-authorization` |
| **Booking links** are 32 random bytes, only a hash is stored, opening one never changes anything, and every link that doesn't work gets the identical answer | `tests/security/booking-link-security.spec.ts` |
| The public **lookup** gives the same answer for a wrong reference and a wrong email, and a stranger is never emailed a link | `tests/security/lookup-enumeration.spec.ts` |
| **Proof uploads**: type from the file's bytes, 5 MB cap while streaming, 3 per booking even when sent at the same instant, Pending bookings only, one client can't touch another's booking | `tests/security/upload-security.spec.ts` |
| Proof files are **unreachable without an admin session**, by any address | `upload-security` |
| **Website photos**: type from content, 15 MB and 50-megapixel limits (a tiny file claiming gigapixels is refused without using memory), metadata removed, permission required, admin only | `tests/security/gallery-upload-security.spec.ts` |
| **Browser protections** on every response: `nosniff`, no framing, a content policy that allows only this site, Bootstrap and the fonts, no inline scripts, HTTPS-only in production | `tests/security/security-headers.spec.ts`, `src/common/public-pages.spec.ts` |
| Every page's outside files come from one exact version with an integrity hash | `src/common/public-pages.spec.ts` |
| The visitor's real address is used behind a hosting proxy only when you say how many proxies there are | `security-headers`, `src/config/env.spec.ts` |
| **Validation** of every request; errors never show internal details; request bodies limited to 16 KB | `tests/contract/api-contract.spec.ts` |
| The database refuses double bookings, a booking without a deadline, a refund that wasn't due, and more | `tests/integration/` |
| Emails never contain a booking link except the one that creates it; owner emails never contain a client's link | `tests/api/booking-email.spec.ts`, `tests/security/booking-link-security.spec.ts` |

## 5. Secrets

| Secret | Where it lives | In Git? |
| --- | --- | --- |
| Database password and address | `.env` locally; the host's settings in production | **No** (`.env` is ignored) |
| Mail provider password | `SMTP_PASSWORD` in `.env` / host settings | **No** |
| Your admin password | Only as an Argon2id hash in the database; you choose it when you run `npm run seed:admin` from your `.env` | **No** |
| Your business bank details | Only in the database, typed in the portal | **No** (the seed holds the text "Not set yet") |
| Booking-link tokens and session keys | Only as hashes in the database | **No** |

`src/common/repository-secrets.spec.ts` reads every file Git tracks and fails if it finds a private key, a cloud or GitHub or Stripe key, a database password for a real server, an SMTP password or a long secret, or if `.env` or `uploads/` is tracked. A second set of tests proves the scanner really catches each kind of secret. Only `.env.example`, with empty values, is committed.

**If a secret leaks:** change it at the source at once (mail password at the provider, database password on the host, your admin password by running `npm run seed:admin` with a new one, which also ends all sessions), then check the logs for use.

## 6. Logs

The app writes one line per request: **method, address, status and time taken**, for example `POST /api/booking/***/proofs 201 49ms`.

| Always left out | Why |
| --- | --- |
| The **booking link** in any address (`/booking/***`) | A link opens a booking |
| Request and response **bodies** | They hold names, emails, phone numbers, passwords and notes |
| Cookies, `Authorization` headers, passwords | Credentials |
| A client's email, phone, name or notes | Personal data |
| The visitor's IP address | Not needed. (It is stored only with a proof upload, for abuse investigation) |

Errors are logged with the booking reference and the reason, never the details above. `tests/security/log-masking.spec.ts` runs a whole journey with the log captured and reads every line.

## 7. What you must still do

These are duties the software can't do for you. Get advice on each.

1. **Write a privacy notice** and link it from the site: who you are, what you collect (section 2), why, how long, who else receives it (your email and hosting providers), and how to contact you. The site doesn't have one yet.
2. **Register an information officer** with the Information Regulator. A sole trader is usually her own information officer, but registration is still required.
3. **Sign data-processing terms** with your email and hosting providers (and read the OpenRouteService terms, `docs/travel.md`), and choose where the data is stored.
4. **Deal with requests.** A client may ask to see, correct or delete their data. Search the Bookings page by their email to see everything held. There is no delete button in v1; ask your developer to remove a client (a short database command) until D1 is decided.
5. **Know what to do after a breach.** If personal data may have been seen by someone it shouldn't, POPIA requires you to tell the Information Regulator and the people affected as soon as reasonably possible. Keep this document and the log retention in mind: they tell you what could have been exposed.
6. **Keep the system updated.** Run `npm audit --omit=dev` now and then (the build does it for you).

## 8. Decisions waiting for the owner

| | Decision | Recommendation |
| --- | --- | --- |
| **D1** | **How long to keep bookings, client details and notification records.** v1 keeps them for ever | Keep for a stated period you can justify (for example 5 years for your accounting records), then delete or anonymise. Say so in the privacy notice. This needs a small deletion job, which can be added once you choose the period |
| **D2** | **Google Fonts and jsDelivr** receive each visitor's IP address | Host the three fonts and Bootstrap from the site itself. This needs downloading those files into the project, which needs your go-ahead |
| **D3** | Where the data is stored (hosting region) | Decided with the hosting choice in M8 |
| **D4** | A **privacy notice** page | Write it from section 2; the home page footer then links to it |

## 9. The review: what was checked and what was found

**Reviewed:** personal data held, retention, access control, secrets in the repository, what is logged, third parties, uploads, response headers, dependencies.

**Found and fixed in this review:**

| Finding | Fix |
| --- | --- |
| No browser security headers at all (framing, sniffing, content policy, referrer) | Added on every response, with a stricter policy for the private booking page and for API answers (`src/common/security-headers.ts`) |
| `X-Powered-By: Express` told visitors what the server runs | Removed |
| Behind a hosting proxy every visitor would share one address, defeating the rate limits and recording the proxy as the uploader | New `TRUST_PROXY` setting (0 to 10 proxies); `X-Forwarded-For` is believed only when you set it |
| The mail library had **eight known high-severity issues** (file read, wrong recipient, denial of service): I had installed an old major version | Upgraded to 10.1.1: **no known vulnerabilities in production dependencies**. The build now fails if one appears (`npm audit --omit=dev --audit-level=high`) |
| The admin rate limit and the services rate limit that `docs/api.md` lists were missing | Added (300 a minute per session; 120 a minute per address) |
| Times in answers had milliseconds, against the API document | Fixed (a contract test now guards it) |
| Nothing stopped a secret being committed | The repository scan above |

**Open:** decisions D1 to D4; the three `braces` advisories reached through `kysely-codegen`, a **developer-only** tool that regenerates database types and is never installed or run on the server (accepted); the duties in section 7.
