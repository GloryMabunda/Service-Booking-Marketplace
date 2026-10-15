# Hosting decision

Decided in #86 (October 2026), by the owner: **one small virtual server (VPS) in South Africa** that runs the app and PostgreSQL together, with a backed-up disk for photos and proofs of payment. This replaces the spec's earlier recommendation of Azure App Service, Azure Database for PostgreSQL and Blob Storage.

## Why a single VPS

| | One VPS in South Africa (chosen) | Azure (earlier recommendation) |
| --- | --- | --- |
| Monthly cost | Roughly R200 to R600 (see below) | Roughly R1,500 or more once the database, the app plan and storage are added |
| Data location | A South African data centre: simple to explain in the privacy notice (POPIA, `docs/security.md` D3) | South Africa North is available, at a higher price |
| Moving parts | One machine, one bill | Three services to configure and pay for |
| Work to build | Docker Compose, a reverse proxy with free HTTPS, nightly backups | Three Azure resources, plus a blob storage provider in code |
| Weak points | You are the system administrator: updates, backups and restores are ours to look after; one machine is a single point of failure | More managed, so less to look after |

For one business with a few bookings a day, the single server is the right size. If the business outgrows it, the app already hides storage behind `FileStorage` and distance lookups behind `DistanceProvider`, so moving the database or the files elsewhere later is a configuration change, not a rewrite.

## What it needs

- **Server:** 2 vCPU, 2 to 4 GB of memory, 40 GB or more of SSD, Linux (Ubuntu LTS), in a South African data centre (Johannesburg or Cape Town).
- **Cost estimate:** local VPS plans of this size were seen at about R200 to R600 a month in October 2026; prices change and vary by provider, so the figure is confirmed when you sign up. Add about R150 a year for a `.co.za` domain. HTTPS certificates (Let's Encrypt) are free. OpenRouteService (travel fees) has a free plan. Email needs an SMTP account (`SMTP_HOST` and friends): many hosts include one, or a free mailbox plan will do for a few emails a day.
- **Backups:** nightly database dump plus a copy of the uploads folder, kept off the server (the provider's snapshot service, or a second small storage account). A backup that has never been restored is not a backup: the release checklist (#92) includes one practice restore.
- **Things that need the owner:** the account and payment card for the VPS provider, the domain name, the SMTP details and the OpenRouteService key. The software never receives these in Git.

## What changes in the plan for M8

| Issue | Change |
| --- | --- |
| #86 Hosting target | Decided here |
| #87 Provision | A VPS instead of Azure resources. The private area is a folder outside the web root; the database listens only on the local network of the server. Written up in `docs/deployment.md` |
| #88 Blob storage provider | **Not needed for the VPS.** `LocalFileStorage` keeps both areas on the server's disk, with backups. Left open only for a future move to cloud storage |
| #89 Production configuration and secrets | Environment variables in a file on the server readable only by the app (not in Git), plus GitHub secrets for the deploy |
| #90 Deployment workflow | GitHub Actions connects to the server over SSH, runs the migrations, and restarts the app, only after CI passes |
| #91 Logging and monitoring | A health check endpoint, logs through the container runtime, and an outside uptime check |
| #92 Release v1.0 | As planned |

## Still to decide with the owner

1. Which VPS provider (price, location, backup service, support in South Africa).
2. The domain name.
3. The email provider for sending (SMTP).
