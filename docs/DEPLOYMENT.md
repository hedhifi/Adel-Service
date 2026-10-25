# Hosting Adel Service

This prepares the app to run somewhere techs can open it on a phone. It does not create a hosting account, buy a domain, or deploy. Stripe stays in **test mode**. Live keys (`sk_live_`, `rk_live_`, `pk_live_`) are refused.

Pick one option at the bottom, then fill secrets in that provider. Do not commit `.env`.

## What production expects

| Need | How |
| --- | --- |
| Build | `pnpm build`, then `next start` (the container entrypoint does both migrate and start) |
| Process | Container entrypoint, or `pnpm start` |
| Migrations | `node packages/db/migrate.mjs` before traffic. The image runs it on start when `RUN_MIGRATIONS` is not `false`. |
| Database | Postgres 16. `DATABASE_URL` |
| HTTPS | Public `APP_URL=https://…`. The session cookie is `Secure` in production. |
| Boot checks | `ADEL_SERVER=1` and `NODE_ENV=production` require a real `SESSION_SECRET` (16+ characters, not a placeholder) and an `https://` `APP_URL`. |
| Photos | `STORAGE_DRIVER=s3` on a host whose disk is wiped on redeploy. `local` is for a disk you control (`UPLOAD_DIR`). |
| Health | `GET /api/health` checks Postgres and storage config. `GET /api/health/live` only checks that the process is up. |
| Cron | `POST /api/cron/run` with `Authorization: Bearer $CRON_SECRET` every 5 minutes. Retries failed webhooks, purges old location points, and sends due "add your notes" reminders. |
| Logs | JSON lines on stdout when `NODE_ENV=production`. `LOG_LEVEL=info` by default there. Stripe keys and token-shaped strings are redacted. |
| Seed | Migrations create tables only. `pnpm db:seed` loads the demo company and the shared password `Fieldnote-demo-2026`, which belongs on localhost. Loading it once on a host requires `ALLOW_REMOTE_SEED=yes`, and those passwords have to change before anyone else signs in. |

`POST /api/cron/run` returns 503 until `CRON_SECRET` is set, so the route is not open by accident. Departure reminders still run when a phone posts a location or the office opens the map.

## Phone app

Techs open `/tech` on HTTPS and use Add to Home Screen. The manifest starts at `/tech` in standalone mode. The service worker caches the offline page and static icons, and does not cache API responses. Camera (`capture="environment"`), microphone (dictation), and GPS are allowed for this origin only.

A photo that fails because the network is down is kept in IndexedDB (up to 10) and sent when the browser is online again. Location points that fail the same way sit in local storage (up to 200) and flush on the next fix. The office desk still needs a connection.

iOS needs a recent Safari and the installed home-screen icon for the most reliable camera and location prompts. Android Chrome can install from the browser menu.

## Photos when the app is hosted

`STORAGE_DRIVER=local` writes `UPLOAD_DIR`. That directory is inside the container at `/data/uploads` and disappears when the container is replaced, unless you mount a volume.

`STORAGE_DRIVER=s3` uses the AWS SDK against any S3-compatible endpoint:

```bash
STORAGE_DRIVER=s3
S3_BUCKET=adel-uploads
S3_REGION=auto
S3_ENDPOINT=https://ACCOUNT.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_FORCE_PATH_STYLE=false
```

Cloudflare R2, Backblaze B2, AWS S3, and MinIO all fit. MinIO (the Compose stack) wants `S3_FORCE_PATH_STYLE=true` and an `http://minio:9000` endpoint. Leave `S3_ENDPOINT` unset for AWS itself. Checksums are sent only when the provider requires them, so MinIO and R2 accept the uploads.

A few gigabytes of job photos on R2 is usually a few dollars a month or inside the free allowance. Turn on bucket versioning if you want a deleted photo back.

## Migrations

```bash
pnpm db:migrate
```

That runs `packages/db/migrate.mjs` with the SQL files in `packages/db/migrations`. It reads `DATABASE_URL` and, when present, `.env` without overriding variables the host already set. Drizzle records applied migrations, so running it twice is safe.

The Docker entrypoint migrates and then starts the server. Fly's release command migrates as well. Render runs the entrypoint on each boot of the single web instance.

## Backups

Do not treat a volume on the same disk as a backup.

- **Render Postgres** (paid): logical backups and point-in-time recovery are part of the database product. Confirm the retention in the dashboard when you create it.
- **Fly Managed Postgres**: backups and high availability are included in the plan price. Storage is billed on top.
- **Compose / VPS**: schedule a nightly dump and copy it off the machine (another disk, or an object bucket).

```bash
./scripts/backup-db.sh
# or, with the prod compose file running:
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U adel --no-owner adel | gzip -c > backups/adel.sql.gz
```

Practice a restore once before anyone depends on it:

```bash
gunzip -c backups/adel.sql.gz | docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U adel -d adel
```

Run that only against a database you are willing to overwrite. For MinIO, mirror the bucket off the box (`mc mirror`). A volume snapshot of the same server is not enough.

## Logs

The app writes one JSON object per line in production: time, level, message, and a few fields. Webhook failures log the delivery id and status, not the signing secret. Ship stdout to the host's log store (Render logs, `fly logs`, or journald on a VPS). `LOG_LEVEL` can be `debug`, `info`, `warn`, or `error`.

## Run the production image yourself

```bash
docker build -t adel-service .
docker run --rm -p 3000:3000 \
  -e DATABASE_URL=postgres://... \
  -e SESSION_SECRET="$(openssl rand -base64 32)" \
  -e APP_URL=https://service.example.com \
  -e STORAGE_DRIVER=s3 \
  -e S3_BUCKET=adel-uploads \
  -e S3_ACCESS_KEY_ID=... \
  -e S3_SECRET_ACCESS_KEY=... \
  -e CRON_SECRET="$(openssl rand -base64 32)" \
  -e STRIPE_SECRET_KEY=sk_test_... \
  -e NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_... \
  -e STRIPE_WEBHOOK_SECRET=whsec_... \
  adel-service
```

`GET /api/health` should return `"db": "up"` and `"stripe": "test"` or `"unconfigured"`. It must not say live.

The Compose file `docker-compose.prod.yml` is the same stack on one machine: Postgres, MinIO, the app, and a cron loop. `docker-compose.yml` is still local Postgres only, so `docker compose up -d --wait` for development does not build the app.

```bash
export POSTGRES_PASSWORD="$(openssl rand -base64 24)"
export MINIO_ROOT_PASSWORD="$(openssl rand -base64 24)"
export SESSION_SECRET="$(openssl rand -base64 32)"
export CRON_SECRET="$(openssl rand -base64 32)"
export APP_URL=https://service.example.com
docker compose -f docker-compose.prod.yml up -d --build
# after DNS points at this machine:
export APP_DOMAIN=service.example.com
docker compose -f docker-compose.prod.yml --profile https up -d
```

Caddy terminates HTTPS for `APP_DOMAIN`. Point `APP_URL` at that `https://` origin.

## Three ways to host it

Prices are list prices checked in October 2026. Recheck them before paying. None of these accounts have been created.

### 1. Render (managed web service + managed Postgres)

Blueprint: `render.yaml` (Ohio, Docker, health check `/api/health`, cron every 5 minutes).

Rough cost: **about $26/month** on the free Hobby workspace. That is a 512 MB web service at $7 plus a 1 GB Postgres at $19. The smallest paid database (256 MB, $6) makes the bill about $13 and is tight for this schema. Photos belong in R2 or similar, usually $0–5. A free web service sleeps when idle, which makes the phone app feel broken, so use a paid instance.

- Pros: least to operate, HTTPS, managed Postgres with backups and point-in-time recovery, blueprint already in the repo, one region close enough to Florida.
- Cons: the web service filesystem is ephemeral, so photos must use S3. Cold builds are slower than a VPS you already patched. Egress past the allowance is extra.

### 2. Fly.io (managed app + managed Postgres)

Config: `fly.toml` (Ashburn, one shared 512 MB machine, HTTPS forced, health check, release command runs migrations). Machines stay on (`auto_stop_machines = "off"`) so the first tap of the day is not a cold start.

Rough cost: **about $42–45/month**. A 512 MB shared machine is about $3.69 if it runs all month. Managed Postgres Basic is $38 plus storage (about $0.28/GB). Fly's own example of a small app plus Managed Postgres lands near $44. An unmanaged Postgres machine with a volume can be under $10, and then backups are yours.

- Pros: container-native, HTTPS, region near the East Coast, health checks in the config. Good if you later want the process closer to a job site.
- Cons: the managed database is most of the bill. You still bring your own S3-compatible bucket for photos (or a single-machine volume, which does not follow a second machine). Cron is not in `fly.toml`; call `POST /api/cron/run` from a scheduled machine or any HTTPS cron.

Secrets, when you are ready, are `fly secrets set`, not lines in `fly.toml`.

### 3. A small VPS and Docker Compose

Config: `Dockerfile`, `docker-compose.prod.yml`, `Caddyfile`.

Rough cost: **about $7–15/month** for the machine. A small Hetzner Cloud box or a 2 GB DigitalOcean droplet is in that range. MinIO on the same machine stores photos. Add a couple of dollars if you copy backups to object storage.

- Pros: one bill, no platform markup, the compose file is the whole system, Caddy gets the certificate.
- Cons: you patch the OS, watch the disk, and run backups yourself. A dead disk takes the database and the photos if the off-site copy is late. No managed point-in-time recovery.

## Recommendation

Use **Render** for the first hosted install: about $26/month, managed Postgres with backups, HTTPS, and the blueprint in `render.yaml`. Put photos in Cloudflare R2 (or another S3-compatible bucket), keep Stripe on test keys, and set `APP_URL` to the `https://` hostname Render gives you before techs install the icon.

Choose Fly if you specifically want the app in Ashburn and will pay about $40 for managed Postgres. Choose the VPS when someone is willing to own OS updates and the nightly `scripts/backup-db.sh` copy.

After the first real URL works, install `/tech` on one phone, take a photo, confirm it is in the bucket, and hit `GET /api/health`.
