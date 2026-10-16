# Run it for development

> The quickest way to just *try* the app is the one-command demo in the [README](../README.md#-quick-start-try-it-with-one-command). This page is for working on the code.

How to run the project on your own computer. These steps were tested on a fresh clone with no `.env`, no installed packages and an empty database.


## Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| [Git](https://git-scm.com/downloads) | Any recent version | To clone the repository |
| [Node.js](https://nodejs.org) | **24 LTS** (see [`.nvmrc`](../.nvmrc)) | Includes npm 11. Node 23 and npm 10 fail to install or run this project |
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

   The business settings start with the default rules (24 hours notice, 50% deposit, hourly slots and so on) and **placeholder banking details**. Once you can sign in, set your real banking and contact details on the **Settings** page in the admin portal (<http://localhost:3000/admin/settings.html>); they live only in the database, never in Git. Until they are set, clients can't book a service that needs a deposit.

6. **Create your administrator account.** In `.env`, set `ADMIN_EMAIL` to your email and `ADMIN_PASSWORD` to a password of at least 12 characters, then run:

   ```bash
   npm run seed:admin
   ```

   It prints "Created the administrator account". Forgot the password? Change `ADMIN_PASSWORD` and run it again: there is no password-reset screen. The password is stored only as an Argon2id hash.


   **Email (optional while you build).** Clients get their payment instructions by email. In `.env`, fill in `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` (for example `Fresh Start Home Services <bookings@your-domain.com>`) and `PUBLIC_URL` (the web address of your site) with the details from your email provider. Leave `SMTP_HOST` empty to send no email: bookings still work and the confirmation page says the email couldn't be sent. Never commit these values; `.env` is git-ignored.

   **Booking links and uploads.** The email's private link opens `/booking/<link>`, where the client can see their booking, upload a proof of payment and cancel. Uploaded proofs are kept in the `uploads/` folder (change it with `UPLOAD_DIR` in `.env`), which is git-ignored and never served directly: only you can open a proof, from the admin portal. Open a booking in the portal to view, accept or reject its proofs; a rejection emails the client your reason. Proof files are deleted automatically 90 days after a booking is finished, keeping only the record. The **Calendar** shows all appointments by month, week or list.

   **Website photos.** Photos for the home page (hero, About and gallery) are checked from their content, turned upright, stripped of all metadata (so no location or camera details reach the site) and saved as WebP in two sizes; the original is not kept. They are served from `/media/` and live in the `uploads/public` folder, separate from proofs of payment in `uploads/private`. The **Website** page in the portal is where you fill in the home page: your tagline and About text, hero and About photos, where you work, WhatsApp and social links, the photo gallery (with a tick to confirm you may show the people in the photos), testimonials and questions. Anything you leave empty is simply left off the home page. `PUBLIC_URL` must be your site's real address for the links in emails to work.
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

More detail on the database, test and CI commands is in the **Technology Stack** section below; the workflow for making changes is in [`CONTRIBUTING.md`](../CONTRIBUTING.md).

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

- 📄 [Specification](specification.md): the requirements; where anything differs, the specification wins
- 🗄️ [Database design](database.md), 🔌 [API](api.md), 🖼️ [Wireframes](wireframes/README.md), 🎨 [Style guide](style-guide.md), ✉️ [Email content](emails.md)
- Everything in [`docs/`]() is listed in the **Documentation** section below
- 🤝 [Contributing](../CONTRIBUTING.md): branches, pull requests and the checks
