# Try it: the one-command demo

For trying the app, showing it to someone, or putting a portfolio demo online. It needs only [Docker](https://www.docker.com/products/docker-desktop/): no Node.js and no database to install.

## Run it

```bash
git clone https://github.com/GloryMabunda/Service-Booking-Marketplace.git
cd Service-Booking-Marketplace
docker compose -f compose.demo.yml up --build
```

The first run takes a few minutes (it builds the app). When the log says the app started, open:

| What | Address |
| --- | --- |
| The client website | <http://localhost:3000> |
| The owner's portal | <http://localhost:3000/admin/>, sign in as `demo@example.com` with the password `demo-admin-1234` |
| The demo mailbox | <http://localhost:3000/demo-mailbox.html> |

Stop it with `Ctrl+C`. `docker compose -f compose.demo.yml down` stops it and keeps your data; add `-v` to delete the demo data too.

To use another port or password: `DEMO_PORT=8080 DEMO_ADMIN_PASSWORD=choose-your-own-1 docker compose -f compose.demo.yml up --build`.

## What you get

- Five made-up services of an imaginary home cleaning and laundry business, with pictures, a home page with About text, testimonials and questions, and a fake bank account, so the whole flow works at once.
- **A demo banner** on every page.
- **A demo mailbox.** The demo sends no email. Every email the app would send (payment instructions with the private booking link, the new-booking email to the owner, confirmations) appears on the demo mailbox page, newest first, with working links. It empties when the demo restarts.
- **Travel fees and home visits.** The two cleaning services are done at the client's place only, and the three laundry services can be dropped off or collected. A client who chooses their own place gives an address and sees the travel fee (a call-out fee plus a rate per kilometre) before booking. The demo has no maps service, so it makes up a believable distance from the address.
- A real PostgreSQL database and everything else exactly as in the real app.

## A good tour

1. Open the website, choose a service, pick a date and time, enter any details and book.
2. Open the demo mailbox: the payment instructions are there. Open the private booking link inside it and upload any small PDF or image as a proof of payment.
3. Sign in to the portal: the booking is there with its proof. Review the proof and confirm the payment.
4. Back in the mailbox, the confirmation email has arrived.

## How it works

| Setting | What it does |
| --- | --- |
| `DEMO_MODE=true` | Keeps emails on the demo mailbox instead of sending them, adds the banner, and lets the health check say `"demo": true` |
| `node dist/scripts/seed-demo.js` | Adds the demo data once, to an empty database. It does nothing if there already are services, and it refuses to run unless `DEMO_MODE=true` |
| `DEMO_ADMIN_PASSWORD` | The demo administrator's password. The default is public, so **set your own on anything online** |

`compose.demo.yml` runs the migrations, the seed and the app one after the other, so there are no setup steps.

## A free hosted demo on Render (a portfolio link)

The repository holds a Render blueprint, [`render.yaml`](../render.yaml): a web service built from the Dockerfile and a free PostgreSQL database, both in Frankfurt. You create the account; nothing in it costs money or needs a card for the free plans.

1. Sign up at <https://render.com> with GitHub, and let it see this repository.
2. In the dashboard choose **New**, then **Blueprint**, pick the repository, and apply `render.yaml`.
3. Render asks for `DEMO_ADMIN_PASSWORD`: type any password of 12 or more characters. It is only stored in Render. Share it with whoever should see the owner's portal, for example in the README.
4. Wait for the first build (a few minutes). The demo is at the address Render shows. This project's is <https://fresh-start-demo.onrender.com>, linked from the top of the README.

How the hosted demo behaves, so nobody is surprised:

- **It sleeps after about 15 minutes without visitors** on the free plan, and the first visit afterwards takes about 30 to 60 seconds to wake it.
- **It starts fresh every time it wakes**: `DEMO_RESET_ON_START=true` empties the database and adds the demo data again, because the pictures live on a disk that the free plan wipes. Whatever a visitor books or changes is gone after the next sleep, which is what you want for a public demo.
- **The free database is deleted 30 days after it was created.** Render emails a warning first. To keep the demo going, create the database again from the blueprint (or move to a paid plan).
- **No real email is ever sent.** The emails appear on `/demo-mailbox.html`, which anyone can open.
- **Never put real data in it.** The administrator's password is shared and the data is public.

## Putting a demo online somewhere else (a portfolio)

Any host that runs a Docker image or a Node.js app plus PostgreSQL will do (for example a free web service with a free database). Set `DEMO_MODE=true`, a `DATABASE_URL`, your own `DEMO_ADMIN_PASSWORD` and `PUBLIC_URL` (the demo's address, with `https://`), and run `node dist/scripts/migrate.js && node dist/scripts/seed-demo.js && node dist/main.js` as the start command.

Two things to know about free hosts:

- **Uploaded pictures and proofs are kept on the server's disk**, and most free hosts wipe it on each restart. The demo data's pictures are made again only on an empty database, so after a restart the services may show their placeholder until you upload pictures again.
- **The mailbox is public.** Anyone who can open the demo can read its emails and open its booking links. That is the point of a demo, and the reason demo mode refuses to start together with a real email provider (`SMTP_HOST`).

## Never for real clients

Demo mode is for made-up data only. Do not use it, and do not put real banking details or real client details in a demo. To run the app for real clients, see [deployment.md](deployment.md).
