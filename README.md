# Service Booking System 💄

[![CI](https://github.com/GloryMabunda/Service-Booking-Marketplace/actions/workflows/ci.yml/badge.svg)](https://github.com/GloryMabunda/Service-Booking-Marketplace/actions/workflows/ci.yml)

> **An appointment booking and management system designed for service-based businesses, allowing clients to discover services, view availability, book appointments online and secure them with a deposit.**

The Service Booking System is a full-stack application designed to help appointment-based businesses manage their services, availability, bookings, deposits and clients from a central platform.

For this portfolio project, the system is implemented around a **makeup artist business**, allowing clients to browse makeup services, view availability, and make appointments online.

The system also provides the makeup artist with a secure administration portal where they can manage services, availability, bookings, deposit payments and client information.

Although the example implementation is for a makeup artist, the underlying booking system is designed to be reusable for other appointment-based service providers.

Examples include:

- Makeup artists
- Hair stylists
- Nail technicians
- Beauty therapists
- Personal trainers
- Photographers
- Tutors
- Cleaning services
- Barbers
- Massage therapists
- Other service-based businesses

The goal is to build a practical booking system that can be adapted to different service businesses by changing configuration, not booking logic.

📄 **The full requirements live in the [Specification](docs/specification.md) (v1.0).** Where this README and the specification differ, the specification wins.

---

# 💻 Getting Started

How to run the project on your own computer. These steps were tested on a fresh clone with no `.env`, no installed packages and an empty database.

## Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| [Git](https://git-scm.com/downloads) | Any recent version | To clone the repository |
| [Node.js](https://nodejs.org) | **24 LTS** (see [`.nvmrc`](.nvmrc)) | Includes npm 11. Node 23 and npm 10 fail to install or run this project |
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) | Any recent version, with Docker Compose v2 | Runs PostgreSQL 17 locally; nothing else needs installing |
| An editor | [VS Code](https://code.visualstudio.com) or [Visual Studio 2022](https://visualstudio.microsoft.com) | Both are set up to run the app with **F5** |

**On Windows**, Docker Desktop needs WSL 2 and the **Virtual Machine Platform** Windows feature, with virtualization turned on in the computer's firmware. If Docker Desktop says "Virtual Machine Platform not enabled", run this in PowerShell **as administrator**, then **restart Windows**:

```powershell
Enable-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform -All
```

Check the versions:

```bash
node -v      # v24.x
npm -v       # 11.x
docker -v
git --version
```

> **PowerShell tip:** if `npm` fails with "npm.ps1 cannot be loaded" or "is not digitally signed", type `npm.cmd` instead of `npm` in every command below.

## Set up and run

1. **Clone the repository and open the folder:**

   ```bash
   git clone https://github.com/GloryMabunda/Service-Booking-Marketplace.git
   cd Service-Booking-Marketplace
   ```

2. **Install the packages** (the exact versions in `package-lock.json`):

   ```bash
   npm ci
   ```

3. **Create your settings file** by copying the example. It already points at the local Docker database, so you don't need to change anything:

   ```bash
   cp .env.example .env
   ```

   In PowerShell: `Copy-Item .env.example .env`. `.env` is git-ignored; never commit it.

4. **Start Docker Desktop**, wait until it says "Engine running", then **start the database**. The first time downloads PostgreSQL (about 100 MB):

   ```bash
   npm run db:up
   ```

5. **Create the tables:**

   ```bash
   npm run db:migrate
   ```

   The business settings start with the Make Up by Glory rules (24 hours notice, 50% deposit, hourly slots and so on) and **placeholder banking details**. Once you can sign in, set your real banking and contact details on the **Settings** page in the admin portal (<http://localhost:3000/admin/settings.html>); they live only in the database, never in Git. Until they are set, clients can't book a service that needs a deposit.

6. **Create your administrator account.** In `.env`, set `ADMIN_EMAIL` to your email and `ADMIN_PASSWORD` to a password of at least 12 characters, then run:

   ```bash
   npm run seed:admin
   ```

   It prints "Created the administrator account". Forgot the password? Change `ADMIN_PASSWORD` and run it again: there is no password-reset screen. The password is stored only as an Argon2id hash.


   **Email (optional while you build).** Clients get their payment instructions by email. In `.env`, fill in `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` (for example `Make Up by Glory <bookings@your-domain.com>`) and `PUBLIC_URL` (the web address of your site) with the details from your email provider. Leave `SMTP_HOST` empty to send no email: bookings still work and the confirmation page says the email couldn't be sent. Never commit these values; `.env` is git-ignored.
7. **Start the app.** It restarts by itself when you save a file in `src/`:

   ```bash
   npm run start:dev
   ```

   Wait for **"Nest application successfully started"**, then open **<http://localhost:3000>**. The admin portal is at **<http://localhost:3000/admin/>**: sign in with `ADMIN_EMAIL` and `ADMIN_PASSWORD`, then open **Services** to add your services. Open **Availability** to set your working hours and block time off. The **Dashboard** shows today's bookings and what needs your attention, and **Bookings** lets you find a booking, confirm its payment once you've seen the money in your bank account, give a client more time to pay, send a new booking link, cancel, or mark it completed or a no-show. Clients see the active services at <http://localhost:3000/services.html> and pick a date and time after pressing **Book**. The API lives under <http://localhost:3000/api>.

   Or press **F5**: in VS Code (**Run the app**), or in Visual Studio after opening `ServiceBookingMarketplace.sln`.

8. **Run the tests:**

   ```bash
   npm test                    # unit tests, no database needed
   npm run test:integration    # database and API tests; Docker must be running
   ```

When you're finished, stop the app with **Ctrl+C** (or **Shift+F5** in the editor) and the database with `npm run db:down`. Your data is kept for next time.

## Everyday commands

| Command | What it does |
| --- | --- |
| `npm run start:dev` | Run the app, restarting on every save |
| `npm run db:up` / `npm run db:down` | Start / stop the database (data is kept) |
| `npm run db:reset` | Delete all local data and start the database again; then run `npm run db:migrate` |
| `npm run db:migrate` | Apply new migrations (after pulling changes that include one) |
| `npm run db:psql` | Open a SQL prompt on the development database |
| `npm run seed:admin` | Create the administrator from `ADMIN_EMAIL` / `ADMIN_PASSWORD`, or reset the password |
| `npm test` / `npm run test:integration` / `npm run test:all` | Unit tests / database and API tests / both |
| `npm run lint` / `npm run format` | Check the code / format it |
| `npm run build` | Compile to `dist/` (production: `npm run start:prod`) |

More detail on the database, test and CI commands is in the **Technology Stack** section below; the workflow for making changes is in [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Troubleshooting

| You see | Cause | Fix |
| --- | --- | --- |
| `Invalid environment configuration: DATABASE_URL: is required but not set` | No `.env` file | Step 3: copy `.env.example` to `.env` |
| `connect ECONNREFUSED 127.0.0.1:5432` | The database isn't running | Start Docker Desktop, then `npm run db:up` |
| `Bind for 0.0.0.0:5432 failed: port is already allocated` | Another PostgreSQL uses port 5432 | Stop it, or set `DB_PORT=5433` in `.env` and change `5432` to `5433` in both URLs there |
| `EADDRINUSE: address already in use :::3000` | The app is already running somewhere | Stop the other copy, or set `PORT=3001` in `.env` |
| `relation "services" does not exist` | The tables haven't been created | `npm run db:migrate` |
| `Cannot seed the administrator: ADMIN_EMAIL: is required` | The admin settings aren't in `.env` | Add `ADMIN_EMAIL` and `ADMIN_PASSWORD` (step 6) |
| "This site can't be reached" on localhost:3000 | The app isn't running or is still starting | Wait for "successfully started" in the terminal |
| `npm ci` fails with `Cannot read properties of null (reading 'edgesOut')` | npm 10 (Node 23) | Install Node 24 LTS |

## Documentation

- 📄 [Specification](docs/specification.md): the requirements; where anything differs, the specification wins
- 🗄️ [Database design](docs/database.md), 🔌 [API](docs/api.md), 🖼️ [Wireframes](docs/wireframes/README.md), 🎨 [Style guide](docs/style-guide.md), ✉️ [Email content](docs/emails.md)
- Everything in [`docs/`](docs/) is listed in the **Documentation** section below
- 🤝 [Contributing](CONTRIBUTING.md): branches, pull requests and the checks

---

# 🚀 Project Overview

The system provides two main experiences:

## 👤 Client Website

Clients can:

- View the business and its services
- View service descriptions, prices, durations and deposit amounts
- View available appointment dates and times
- Make a booking without creating an account
- Provide their contact details
- Receive payment instructions by email, with a private **booking link**
- Upload proof of payment through the booking link (from a phone or desktop)
- Cancel their booking through the booking link, and see whether the deposit is refundable
- Look up their booking details with the booking reference and email address

## 🔐 Administrator Portal

The service provider can securely log in and:

- See a dashboard of today's and upcoming bookings, deposits awaiting payment, proofs awaiting review and refunds due
- View all bookings and filter them (including by "proof received")
- View individual booking details and client information
- Review uploaded proofs of payment and accept or reject them
- Confirm payment once the deposit reflects in the bank account
- Extend a deposit deadline, cancel bookings, mark bookings completed or no-show
- Record refunds that have been paid
- Manage services, pricing and durations
- Manage working hours and block dates and times
- View appointments through a calendar
- Configure settings: minimum notice, advance booking window, slot interval, buffer time, deposit percentage, refund rule, deposit hold time, time zone and banking details

---

# 🌍 Real-World Use Case

The portfolio implementation uses **Make Up by Glory** as the example business.

A client visiting the website could:

```text
View Services
      ↓
Choose a Makeup Service
      ↓
View Available Dates
      ↓
Choose Available Time
      ↓
Enter Contact Details
      ↓
Booking Created (Pending)
      ↓
Email with Payment Instructions and Booking Link
      ↓
Pay Deposit by EFT and Upload Proof
      ↓
Owner Confirms Payment
      ↓
Booking Confirmed
```

The same system could then be configured for another service provider without changing the fundamental booking functionality.

---

# ✨ Key Features

## 💄 Service Management

Administrators can create and manage services.

Each service can contain:

- Service name
- Description
- Price
- Duration
- Active/inactive status

Example:

| Service | Duration | Price |
|---|---:|---:|
| Soft Glam | 1h 30m | R650 |
| Full Glam | 2h | R850 |
| Bridal Makeup | 2h 30m | R1,200 |
| Matric Dance Makeup | 2h | R900 |

These examples are specific to the makeup artist implementation and can be replaced with services appropriate to another business.

Inactive services are hidden from clients and can't be newly booked; existing bookings are unaffected.

---

## 📅 Availability Management

The service provider can define when appointments are available.

The system supports:

- Working days and working hours
- Service duration
- A buffer after every appointment
- Start times on a fixed slot interval
- Existing bookings (Pending and Confirmed)
- Blocked dates and blocked time periods
- A minimum notice period and a maximum advance booking window
- Multiple appointments per day

Availability is calculated by the server. A start time is offered only if the service duration plus the buffer fits inside working hours without overlapping another booking or a blocked period.

For example, with a 1-hour buffer, a 2-hour service needs 3 free hours, so the system won't offer a time that would run into the next appointment.

All times are stored in UTC and shown in the business's time zone (South Africa Standard Time for Make Up by Glory).

---

## 📌 Booking System

Clients can select:

1. Service
2. Date
3. Available time
4. Contact details
5. Optional booking notes

The system re-validates availability when the booking is submitted, and the database itself prevents two overlapping bookings, so two clients can never both book the same slot.

Each email address or phone number can have at most 2 bookings awaiting a deposit, and the booking form is rate-limited.

### Booking Statuses

| Status | Meaning |
|---|---|
| Pending | Waiting for the deposit; holds the slot until the deposit deadline |
| Confirmed | Deposit received and verified by the owner |
| Completed | The appointment took place |
| No-show | The client didn't arrive |
| Cancelled | Cancelled by the client or the owner; the slot is freed |
| Expired | The deposit deadline passed; the slot is freed |

If the deposit percentage is set to 0, bookings skip Pending and start Confirmed.

---

## 💳 Deposits and Proof of Payment

Version 1 uses manual EFT payments rather than an online payment gateway:

1. The deposit is a single percentage of the service price, set by the owner.
2. The client receives an email with the deposit amount, banking details, the booking reference to use as the payment reference, and the deadline.
3. The client pays by EFT and uploads proof of payment (PDF, JPEG or PNG, up to 5 MB) through their booking link.
4. The owner is notified of every upload.
5. The owner confirms the booking **only after the money reflects in her bank account**, never from the proof alone.

If the deadline passes before payment is confirmed, the booking expires and the slot reopens. The owner can extend the deadline while she checks.

Clients can cancel through the booking link before the appointment. Deposits are refundable when the client cancels at least 24 hours before the appointment, and the owner is told when a refund is due.

Payments sit behind a `PaymentProvider` interface, so an online payment gateway can be added later without changing booking logic.

---

## 🧾 Booking Details

Administrators can view detailed information about each booking.

Example:

```text
Booking #BK-000123

Client:
Sarah Mokoena

Email:
sarah@example.com

Phone:
082 XXX XXXX

Service:
Soft Glam Makeup

Date:
17 October 2026

Time:
10:00 – 11:30

Price:
R650

Deposit:
Paid · confirmed 15 October 2026

Status:
Confirmed

Notes:
Birthday makeup
```

---

# 🔔 Notifications

Every booking event sends an email to the client, the service provider, or both. SMS is planned for a later version.

## 👤 Client

- Payment instructions with the booking link (or a confirmation, when no deposit applies)
- Booking confirmed
- Proof of payment rejected, with the reason
- Booking cancelled or expired

Example:

> Thank you for booking Soft Glam Makeup on 17 October at 10:00. To secure your appointment, please pay the deposit by EFT using reference BK-000123 before 15 October at 10:00, then upload your proof of payment using your booking link. Your booking is confirmed once the payment reflects in our account.

## 💼 Service Provider

- Every new booking
- Every new proof-of-payment upload
- Every client cancellation, flagged when a refund is due

Example:

> New booking BK-000123 from Sarah Mokoena for Soft Glam Makeup on 17 October at 10:00. Deposit due by 15 October at 10:00.

The notification system is designed so that email and SMS providers can be integrated without tightly coupling them to the booking logic. A failed email is logged and never blocks or loses a booking.

Development and tests use a mock notification provider; production uses Nodemailer.

---

# 📊 Administrator Portal

The administrator dashboard provides an overview of the business's bookings.

Example:

```text
Good morning, Glory 👋

Today's Bookings          3
Upcoming Bookings         12
Completed This Month      24
Awaiting Deposit          4
Proofs Awaiting Review    2
Refunds Due               1

Upcoming Appointments
--------------------------------
Sarah Mokoena    Soft Glam    09:00
Jane Dlamini     Bridal       12:00
Lerato M.        Full Glam    15:00
```

The administrator can also switch to a calendar view to manage appointments and availability.

---

# 🛠️ Technology Stack

## Backend

- Node.js
- TypeScript
- NestJS
- REST API

## Frontend

- HTML5
- CSS3
- Bootstrap
- Bootstrap Icons
- Vanilla JavaScript

## Database

- PostgreSQL 17 (run locally with Docker Compose)

Settings such as the database address are read from a `.env` file: copy [`.env.example`](.env.example) to `.env` (it is git-ignored, so secrets never reach GitHub). The app checks every variable at startup and refuses to start, naming the problem, if one is missing or invalid; the rules are in `src/config/env.ts`.

With Docker Desktop running, `npm run db:up` starts PostgreSQL with two databases: `booking` for development and `booking_test` for automated tests, both with the `btree_gist` extension. `npm run db:down` stops it, `npm run db:reset` wipes and recreates it, and `npm run db:psql` opens a SQL prompt. Connection details are in [`docker-compose.yml`](docker-compose.yml).

The schema is built by migrations in `src/database/migrations/`, run with [kysely-ctl](https://github.com/kysely-org/kysely-ctl):

| Command | What it does |
| --- | --- |
| `npm run db:migrate` | Applies new migrations to the development database |
| `npm run db:migrate:test` | The same for the test database (also runs automatically before `npm run test:integration`) |
| `npm run db:migrate:make -- <name>` | Creates a new, empty migration file |
| `npm run db:migrate:down` | Undoes the most recent migration |
| `npm run db:migrate:list` | Shows which migrations have run |
| `npm run db:types` | Regenerates `src/database/database.types.ts` from the development database after a migration |

## Libraries

- FullCalendar — appointment calendar
- Nodemailer — email notifications
- Multer (through NestJS) — proof-of-payment uploads
- `file-type` — checks uploaded files by their content
- Kysely: type-safe SQL query builder on the `pg` (node-postgres) driver, no ORM (decided in #18)
- Additional lightweight libraries where they provide clear value

The project intentionally avoids large frontend frameworks such as React, Angular, or Vue.

The frontend will use standard HTML, CSS, Bootstrap, and vanilla JavaScript to keep the application lightweight and demonstrate understanding of the underlying web technologies.

## Development

- Git
- GitHub
- GitHub Actions
- npm
- REST APIs
- Automated testing with [Vitest](https://vitest.dev)

| Command | Runs | Where the tests live |
| --- | --- | --- |
| `npm test` | **Unit** tests: one piece of logic at a time, with no database or `.env`. They take milliseconds. | Next to the code: `src/**/*.spec.ts` |
| `npm run test:integration` | **Integration**, **API** and **concurrency** tests against the test database and the whole app. Needs Docker running (`npm run db:up`); migrates the test database first. | `tests/integration/`, `tests/api/` |
| `npm run test:all` | Both of the above | |
| `npm run test:watch` | Unit tests again on every save | |
| `npm run test:cov` | Unit tests with a coverage report in `coverage/` | |

**Continuous integration.** On every pull request into `main` and every push to `main`, [GitHub Actions](.github/workflows/ci.yml) starts its own PostgreSQL 17, then runs lint, the formatting check, the build, both test commands, and a check that `src/database/database.types.ts` matches the migrations. "Lint, build and test" is a required check, so a pull request can't be merged until it passes.

Integration tests use the helpers in `tests/helpers/`: `createTestDatabase()` connects to `TEST_DATABASE_URL`, and `inRolledBackTransaction()` undoes everything a test inserted.

## Hosting

- Recommended: Azure App Service, Azure Database for PostgreSQL and private Azure Blob Storage in South Africa North (to be confirmed in M8)

---

# 🏗️ Architecture

The application follows a modular backend architecture.

```text
Client Browser
      │
      │ HTTP / REST
      ▼
┌──────────────────────┐
│      NestJS API      │
├──────────────────────┤
│ Auth                 │
│ Services             │
│ Availability         │
│ Bookings             │
│ Payments             │
│ Storage              │
│ Notifications        │
│ Settings             │
│ Admin                │
└──────┬────────┬──────┘
       │        │
       ▼        ▼
 PostgreSQL   File storage
              (proof of payment)
```

---

# 🧩 Core Modules

| Module | Responsibility |
|---|---|
| auth | Administrator login, password hashing, authorization guards |
| services | Service management and public listing |
| availability | Working hours, blocked times, slot calculation, notice and advance windows |
| bookings | Create, view, status changes, conflict handling, deposit deadline and expiry job |
| payments | Deposit calculation, `PaymentProvider` interface, manual EFT verification, proof-of-payment upload and review |
| storage | `FileStorage` interface; local disk in development, private cloud storage in production |
| notifications | Email (SMS later) behind an interface; mock and real providers |
| settings | Notice, advance window, slot interval, buffer, deposit, refund rule, hold time, time zone, banking details |
| admin | Dashboard, calendar data, booking management and proof review |

---

# 🔄 Booking Flow

```text
Client
  │
  ▼
View Services → Select Service → Select Date → Select Time
  │
  ▼
Enter Client Details → Submit Booking
  │
  ▼
Server-Side Checks (availability, notice, booking limits)
  │
  ├── Check fails
  │       └── Return error, client picks another time
  │
  └── Checks pass
          │
          ▼
   Create Booking (Pending) and Booking Link
          │
          ▼
   Email Client (payment instructions + booking link)
   Notify Administrator
          │
          ▼
   Client Pays Deposit by EFT and Uploads Proof
          │
          ▼
   Administrator Notified → Checks Bank → Confirms Payment
          │
          ├── Confirmed → Client receives confirmation
          │
          └── Deadline passes first → Booking expires, slot reopens
```

The client can cancel through the booking link at any point before the appointment.

---

# 🗄️ Database

The database includes these entities:

- Users
- Services
- Availability
- BlockedTimes
- Bookings
- PaymentProofs
- Notifications
- Settings

Overlapping bookings are blocked by a PostgreSQL exclusion constraint, so double-booking is impossible even under simultaneous requests.

The full database design will be documented in [`docs/database.md`](docs/database.md).

---

# 🔐 Security

The administrator portal includes authentication and authorization.

Security considerations include:

- Password hashing
- Secure authentication
- Role-based authorization on every admin route
- Client-side and server-side input validation (the server is authoritative)
- Booking links are unguessable random tokens, stored only as hashes
- Booking lookup never reveals whether another client's booking exists
- Proof-of-payment files are checked by content, size-limited, stored privately and visible only to the administrator
- Rate limits on booking, lookup and upload
- Personal data handled in line with POPIA; proof files are deleted 90 days after a booking ends
- Environment-based configuration for secrets

Sensitive credentials and API keys will not be stored in source control.

---

# 🧪 Testing Strategy

The project will include automated testing for important business logic.

Testing will cover areas such as:

### Unit Tests

```text
✓ Service validation
✓ Availability calculation
✓ Booking validation
✓ Booking status changes
✓ Deposit and deadline calculation
✓ File type and size validation
✓ Notification triggers
```

### Integration Tests

```text
✓ Database operations
✓ Booking creation
✓ Availability checks
✓ Expiry job freeing slots
✓ Booking link creation and regeneration
✓ Proof upload and storage
✓ Client cancellation and refunds due
✓ Authentication
✓ Authorization
```

### API Tests

```text
✓ Endpoint contracts and error responses
✓ Upload error codes
✓ Invalid booking links
✓ Proof files unreachable without admin login
```

### Concurrency Tests

Particular attention will be given to booking availability because preventing double-booking is a core requirement of the system.

```text
Client A ──┐
           ├──> Same Time Slot
Client B ──┘
              │
              ▼
       Database Constraint
              │
       ┌──────┴──────┐
       ▼             ▼
   First Request  Second Request
       │             │
       ▼             ▼
   Create          Reject
   Booking         (409 Conflict)
```

---

# 📚 Documentation

Project documentation is maintained in the `docs/` directory.

| Document | Status |
|---|---|
| [Specification](docs/specification.md) | ✅ v1.0 approved |
| [Database design](docs/database.md) | ✅ Done |
| [API specification](docs/api.md) | ✅ Done |
| [Wireframes](docs/wireframes/README.md) | ✅ Done |
| [Style guide](docs/style-guide.md) | ✅ v1 (colours, fonts, components, logo) |
| [Email content](docs/emails.md) | ✅ Done |
| Security and POPIA (`docs/security.md`) | Planned (M7) |
| Deployment (`docs/deployment.md`) | Planned (M8) |

---

# 🗺️ Development Roadmap

Work is tracked in [GitHub milestones](https://github.com/GloryMabunda/Service-Booking-Marketplace/milestones) and issues.

| Milestone | Outcome |
|---|---|
| M0 · Requirements & design | Approved specification, database design, API, wireframes and email content |
| M1 · Foundation | NestJS project, PostgreSQL, migrations, configuration, tests and CI |
| M2 · Services | Administrator login, settings, service management, public service listing |
| M3 · Availability | Working hours, blocked times, time zones, slot calculation, date and time picker |
| M4 · Bookings | Booking creation, deposits and deadlines, booking link, expiry, double-booking prevention |
| M5 · Notifications | Payment instructions, confirmations, cancellations and admin emails |
| M6 · Admin portal & proof of payment | Dashboard, payment confirmation, proof upload and review, client cancellation, refunds, calendar |
| M7 · Testing & hardening | Security, API, end-to-end and accessibility testing, POPIA review |
| M8 · Deployment | Production hosting, automated deployment, monitoring, v1.0 release |

---

# 🚀 Future Enhancements

Potential future features include:

- Online payment gateway with automatic confirmation and refunds
- Automatic proof-of-payment checks
- Automated appointment reminders
- Rescheduling
- Cancellation fees and policies
- Client accounts
- Reviews and ratings
- Promotional discounts
- Multiple service providers
- Multiple locations
- Business analytics
- Revenue reporting
- Calendar synchronization
- SMS and WhatsApp notifications
- AI-powered booking assistance

---

# 🎯 Project Goals

This project is designed to demonstrate practical full-stack development using a real-world business scenario.

It demonstrates experience with:

- TypeScript
- Node.js
- NestJS
- REST API development
- PostgreSQL
- Relational database design
- Authentication and authorization
- Business-rule implementation
- Appointment scheduling
- Availability calculations
- Double-booking prevention
- Secure file upload
- Deposit and payment workflows
- External service integration
- Email notifications
- Automated testing
- CI/CD
- Application architecture

The project also demonstrates how a real business process can be translated into software with clear business rules, data relationships, validation, and administrative workflows.

Although **Make Up by Glory** is used as the primary example, the underlying system is intentionally designed as a reusable service-booking platform that can be adapted to many different appointment-based businesses.

---

# 📁 Repository Structure

```text
Service-Booking-Marketplace/
│
├── src/
│   ├── auth/
│   ├── services/
│   ├── availability/
│   ├── bookings/
│   ├── payments/
│   ├── storage/
│   ├── notifications/
│   ├── settings/
│   ├── admin/
│   └── database/
│       ├── migrations/       (schema changes, oldest first)
│       └── database.types.ts (generated by npm run db:types)
│
├── public/              (the website, served at /)
│   ├── index.html
│   ├── css/            (tokens.css from the style guide, site.css for the page frame)
│   ├── js/layout.js    (shared <site-header> and <site-footer>)
│   └── images/logo/
│
├── tests/
│   ├── integration/  (real test database)
│   ├── api/          (HTTP requests to the whole app)
│   ├── helpers/
│   └── setup/
│
├── docs/
│
├── docker/postgres/init/   (database setup run on first start)
│
├── uploads/          (local proof-of-payment files, git-ignored)
├── .env.example      (copy to .env; every setting the app reads)
├── .gitignore
├── docker-compose.yml
├── package.json
├── CONTRIBUTING.md   (how to make a change)
├── README.md
└── tsconfig.json
```

---

# 🚧 Project Status

**Currently in development.** Requirements and design (M0) and the foundation (M1) are complete: the app runs locally with its database, tests and CI. Services (M2) are next.

The project is being developed incrementally, with the architecture, database design, implementation, testing, and deployment documented throughout the development process.

---

# 🤝 Contributing

Every change goes through an issue, a branch named after it (`feature/12-short-name`), and a pull request into `main` that says `Closes #12`. Pull requests merge only when CI passes and every checkbox on the pull request and its issue is ticked. The full workflow, commit style and project conventions are in [`CONTRIBUTING.md`](CONTRIBUTING.md).

---

# 📌 Future Vision

The long-term goal is to create a reusable booking platform that can support different types of service-based businesses.

The system should allow a business owner to:

```text
Configure Services
        ↓
Set Working Hours
        ↓
Manage Availability
        ↓
Receive Bookings and Deposits
        ↓
Manage Appointments
        ↓
Notify Clients
        ↓
Track Business Activity
```

The makeup artist implementation provides the initial real-world scenario while keeping the underlying architecture flexible enough to support other appointment-based businesses.

---

## 💄 Project

**Service Booking System**

Appointment booking and management platform for service-based businesses.

Built with **Node.js / TypeScript / NestJS / PostgreSQL**.
