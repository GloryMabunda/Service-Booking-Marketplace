# Deployment

How the app runs in production, and how a new version gets there. The portfolio demo runs on Render ([see below](#deploying-the-portfolio-demo-on-render)); a real business runs on one South African VPS. The hosting choice is in [hosting.md](hosting.md). The files are in [`deploy/`](../deploy), the [`Dockerfile`](../Dockerfile) and [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml).

## Deploying the portfolio demo on Render

The portfolio demo of this project runs on Render's free plan, in demo mode, with made-up data. It is the answer to "where is it hosted" for the portfolio ([hosting.md](hosting.md) explains the choice). **It is not for real clients.** A real business uses the server steps in the rest of this document.

**What gets created.** [`render.yaml`](../render.yaml) describes two things in Render's Frankfurt region: a web service built from the project's [`Dockerfile`](../Dockerfile), and a free PostgreSQL database. Nothing else is needed.

**How to deploy it**

1. Sign up at <https://render.com> with GitHub and let it see this repository.
2. Choose **New**, then **Blueprint**, pick the repository and the `main` branch, and apply `render.yaml`.
3. When Render asks, type `DEMO_ADMIN_PASSWORD` (12 or more characters). It is stored only in Render.
4. Wait for the first build. Render gives the service its address, for example `https://fresh-start-demo.onrender.com`.

The full walkthrough, with the free plan's limits, is in [demo.md](demo.md#a-free-hosted-demo-on-render-a-portfolio-link).

**How it starts.** `npm run start:demo` runs four steps one after the other, and stops at the first one that fails, so a broken step never leaves a half-started app: it empties the demo database, applies the migrations, adds the demo data, then starts the app. After the first deploy, Render redeploys by itself whenever `main` changes.

**Settings**

| Setting | Where it comes from |
| --- | --- |
| `DATABASE_URL` | Render, from the database in `render.yaml` (its internal address) |
| `DEMO_ADMIN_PASSWORD` | You type it in Render. It is never in Git |
| `NODE_ENV`, `DEMO_MODE`, `DEMO_RESET_ON_START`, `TRUST_PROXY` | `render.yaml` |
| `PUBLIC_URL` | Taken from Render's own `RENDER_EXTERNAL_URL` |
| `BREVO_API_KEY`, `MAIL_FROM`, `DEMO_REAL_EMAIL` | Optional. Add them by hand in Render's Environment tab to let the demo send real email within limits ([demo.md](demo.md#real-email-from-the-demo-optional)) |

**Security on Render**

- **No secrets in Git or in workflow files.** The only secrets, the admin password and the Brevo key, exist only in Render's Environment tab. The repository is scanned for secrets by the tests.
- **The database is reached through Render's internal address**, which only your own Render services can use. Keep the database's **external** access closed: in Render, open the database, check its access control, and remove any entry that allows every address.
- **Uploads stay private where they should.** Proofs of payment are kept in a private area and shown only to the signed-in administrator through the app; only website photos are public. The app checks every upload's real file type, and accepts only JPEG, PNG, WebP and PDF.
- **No malware scanning.** Render does not offer it. Because the demo holds only made-up data, this is acceptable here. A real site should use a host or a tool that scans uploads.

**Health and logs.** `/api/health` is the health check Render uses. Errors and the application's logs are in the service's **Logs** tab in Render. Booking links and their tokens are masked in the logs, as in the VPS setup.

**Limits of the free plan**

- The service sleeps after about 15 minutes without visitors, and the first visit afterwards takes about a minute.
- It starts fresh every time it wakes, so nothing a visitor does lasts. That is the intention.
- The free database is deleted 30 days after it was created. Recreate it from the blueprint to keep the demo going.

For a real business, continue with the steps below.

## The picture

```
internet ──443──> Caddy (HTTPS, free certificate)
                    └──> app (the Node.js app, port 3000, private)
                           ├──> db (PostgreSQL 17, private)
                           └──> uploads (a Docker volume: proofs and photos)
```

Everything runs as three containers started by one `docker-compose.yml` in `/opt/booking` on the server. Only Caddy publishes ports (80 and 443). The database and the app can't be reached from the internet. Each container's log is kept small (5 files of 10 MB).

## One-time setup of the server (you, or your developer)

1. **Create the VPS** with Ubuntu LTS and add your SSH key. Give the server a name in DNS: an `A` record for your domain pointing at the server's address.
2. **Update and protect it.** `apt update && apt upgrade`; turn on automatic security updates (`unattended-upgrades`); allow only ports 22, 80 and 443 in the firewall (`ufw`); disable password logins for SSH.
3. **Install Docker** (the official `docker-ce` packages with the Compose plugin).
4. **Make a deploy user** that can run Docker but has no other power: `adduser deploy`, `usermod -aG docker deploy`, and `mkdir /opt/booking && chown deploy /opt/booking`.
5. **Make a deploy key.** On your computer: `ssh-keygen -t ed25519 -f deploy_key -N ""`. Put `deploy_key.pub` in `/home/deploy/.ssh/authorized_keys` on the server. Keep `deploy_key` (the private half) for step 8 and then delete it from your computer.
6. **Create `/opt/booking/.env`** from [`deploy/.env.production.example`](../deploy/.env.production.example) and fill it in (the file lists each value). `chmod 600 /opt/booking/.env`. This file is the only place the production secrets live: never in Git, never in a workflow.
7. **Let the server download the image.** The image is published to GitHub's registry as `ghcr.io/<owner>/<repo>`. Either make that package public (the image holds no secrets: the code is the same as in the repository) or, on the server, run `docker login ghcr.io` with a read-only token.
8. **Tell GitHub about the server.** In the repository, Settings, Environments, create `production` and add the secrets `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY` (the private key from step 5) and `DEPLOY_KNOWN_HOSTS` (the output of `ssh-keyscan -t ed25519 <host>`, checked against the fingerprint your provider shows). Under Settings, Variables, add `SITE_ADDRESS` (your domain). You can also add a required reviewer to the environment, so every deploy waits for your click.
9. **Turn it on.** Add the variable `DEPLOY_ENABLED` = `true`. Until then the workflow does nothing.
10. **Run the first deploy** from the Actions tab (Deploy, Run workflow). Then create the administrator, typing the password at the prompt so it isn't kept in a file:

    ```bash
    cd /opt/booking
    read -rp "Admin email: " E; read -rsp "Admin password (12+ characters): " P; echo
    APP_IMAGE=$(cat current-image) docker compose run --rm -e ADMIN_EMAIL="$E" -e ADMIN_PASSWORD="$P" app node dist/scripts/seed-admin.js
    unset P
    ```

11. **Set up backups** (see below), including a copy off the server.
12. **Set up outside monitoring**: a free uptime service (for example UptimeRobot) that requests `https://<your domain>/api/health` every 5 minutes and emails you when it fails.

## What happens on each deploy

After every push to `main` whose CI run passes, the Deploy workflow:

1. builds the image from exactly the commit CI tested and pushes it to the registry;
2. copies `docker-compose.yml`, `Caddyfile` and the scripts to `/opt/booking`;
3. runs `deploy.sh <image>` on the server, which
   1. **backs up** the database and the uploads,
   2. **applies the database migrations** with the new version (`node dist/scripts/migrate.js`). **If a migration fails, the deploy stops here and the running version is not changed**: a failed migration is rolled back by PostgreSQL and the old app keeps serving,
   3. starts the new version and waits for its health check; **if it never becomes healthy, the previous version is put back**;
4. finally requests `/api/health` on the live address.

Because the old version keeps running while migrations are applied (and returns if the new one fails), every migration must work with both versions: add columns and tables first, and remove or rename them in a later release.

## Backups and restoring

- `backup.sh` makes `backups/db-<time>.sql.gz` and `backups/uploads-<time>.tar.gz`, and deletes ones older than 14 days. It runs before every deploy and nightly: add `15 2 * * * /opt/booking/backup.sh` to the deploy user's crontab (`crontab -e`).
- **Copy the `backups` folder off the server** every night (for example `rclone` or `rsync` to a second provider, or the provider's own snapshot service). A backup on the same machine is lost with the machine. The copies hold client details and proofs of payment: keep them private and encrypted at rest, and cover them in the privacy notice (`docs/security.md`).
- `restore.sh <time>` puts a backup back (it asks first). **Practise a restore once** on a spare copy before you rely on it; the v1.0 release checklist (#92) includes it.

## Logs and health

- `GET /api/health` answers `{"status":"ok"}` when the app can reach its database, and 503 otherwise. Docker uses it to mark the app healthy, `deploy.sh` waits for it, and the outside monitor asks it.
- Errors and request lines go to the container log: `docker compose logs --tail 200 app`. Booking links are masked (`/booking/***`) and client details are not written to the log (`docs/security.md`, checked by tests).

## Settings that production requires

The app refuses to start in production without an email provider (`SMTP_HOST`, or `BREVO_API_KEY` to send through Brevo's web API; not both), a `MAIL_FROM` sender (clients must get their emails) and `PUBLIC_URL` (links in emails), and `deploy/docker-compose.yml` refuses to start without `DB_PASSWORD` and `SITE_ADDRESS`. `TRUST_PROXY=1` tells the app that Caddy is in front, so rate limits count each visitor and not Caddy.

## Trying the image on your own computer

```bash
docker build -t booking-test .
```

The image runs as an unprivileged user, keeps uploads in `/data/uploads` (a volume) and needs the settings above. The automated tests do not use it: they run against the source.
