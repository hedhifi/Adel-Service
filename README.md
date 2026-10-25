# Adel Service

Internal field-service desk for **Adel Electric, LLC**. Office staff schedule work. Technicians run the day from a phone. The same app exposes a REST API and a small MCP server so an assistant can work with the same records.

This is not a product for other contractors.

## Stack

| Piece | Choice |
| --- | --- |
| Language | TypeScript |
| Package manager | pnpm workspaces |
| App | Next.js (`apps/web`) — office UI and the technician PWA in one app |
| Database | Postgres 16, schema in `packages/db` (Drizzle ORM, SQL migration) |
| Domain logic | `packages/core` — shared by the UI, the HTTP API, and tests |
| Auth | Session cookie `adel_session`, plus role-scoped API tokens |
| Tests | Vitest |
| Payments | Stripe **test mode only**. Live keys are refused |
| Assistant | `packages/mcp` speaks MCP over stdio and calls the REST API |

One Next.js app keeps the office desk and the installable field app on the same session and the same API. Drizzle is here because the migration is plain SQL you can read. Sessions are first-party because there is a single company and three roles, not a hosted identity product. The MCP server is a client of the HTTP API so the assistant cannot drift from the documented routes.

## Layout

- `apps/web` — office pages, `/tech` field app, `/api` routes, service worker
- `packages/db` — schema, migration, seed
- `packages/core` — customers through payments, webhooks, tokens
- `packages/mcp` — MCP tools
- `companion/` — Expo scaffold for company phones (not in the pnpm workspace, not a store build)
- `openapi/openapi.yaml` — the API contract (`/api/openapi` serves the JSON copy)

## Run it

Requirements: Node 20 or newer (22 is what CI uses), pnpm 10, and Docker.

```bash
pnpm install
cp .env.example .env
docker compose up -d --wait
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Open http://localhost:3000.

The first time the Postgres volume is created, Compose also creates the `adel_test` database used by tests. If you already had a volume from before that script existed:

```bash
docker compose exec postgres psql -U adel -d adel -c "SELECT 1 FROM pg_database WHERE datname = 'adel_test'" | grep -q 1 \
  || docker compose exec postgres psql -U adel -d adel -c "CREATE DATABASE adel_test OWNER adel"
```

### Demo logins

Password for every seeded person: `Fieldnote-demo-2026`

| Person | Email | Role |
| --- | --- | --- |
| Alan Drespel | alan@adel.example | admin |
| Renee Okonkwo | renee.okonkwo@adel.example | office |
| Marco Vell | marco.vell@adel.example | tech |
| Sofia Brennan | sofia.brennan@adel.example | tech |

Seeded work includes a new request, a sent estimate with a public link, visits for today, an unpaid invoice, and a paid invoice. The seed prints a new admin API token. It refuses to wipe an existing database unless you run `SEED_RESET=yes pnpm db:seed`.

### Tests

```bash
pnpm test
pnpm typecheck
```

Tests use `TEST_DATABASE_URL` (`adel_test` by default) and do not touch the dev database.

### Stripe test mode

1. In the [Stripe test dashboard](https://dashboard.stripe.com/test/apikeys), copy the test secret and the test publishable key.
2. Put them in `.env` as `STRIPE_SECRET_KEY=sk_test_…` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_…`. Placeholders that contain `replace` count as “not configured.”
3. Restart `pnpm dev`.
4. On an issued invoice, take a card. Test card `4242 4242 4242 4242`, any future expiry, any CVC.
5. For the Stripe webhook, point the test endpoint at `http://localhost:3000/api/stripe/webhook` (the Stripe CLI works: `stripe listen --forward-to localhost:3000/api/stripe/webhook`) and set `STRIPE_WEBHOOK_SECRET` to the `whsec_…` signing secret it prints.

Keys starting with `sk_live_`, `rk_live_`, or `pk_live_` are rejected.

### MCP server

Create an API token under Settings → API tokens (admin), then:

```bash
# in .env
ADEL_API_BASE=http://localhost:3000
ADEL_API_TOKEN=adel_...

pnpm mcp
```

The process speaks MCP on stdin/stdout. Point an MCP client at `pnpm mcp` from this repo. Tools cover customers, requests, estimates, scheduling, visit completion, invoices, and manual payments. Card charges stay in the invoice screen.

### Technician install

On a phone, open `/tech` in the browser and use Add to Home Screen. `manifest.webmanifest` and `sw.js` make that installable. It is a web app, not a native store build.

### Voice on the phone

Free-text fields on a visit (notes, checklist notes, time notes, photo captions, and the signature name) keep a typed box and add Dictate. The browser speech API is used, with a phrase grammar when the engine accepts one. Safari without grammars still records.

After the engine returns words, the phone posts them to `POST /api/v1/speech/cleanup`. The server fuzzy-corrects the dictionary (Settings → Speech dictionary, plus customer names from the database). Short terms of four letters or fewer, such as DMX or 2N, match only when the letters are the same. Longer terms allow a small edit distance. Numbers change only when the dictionary term itself contains those same digits.

If `SPEECH_CLEANUP_API_KEY` is missing, still a placeholder that contains `replace`, or `SPEECH_CLEANUP=off`, cleanup stops there. The field shows the dictionary-corrected text. The stored original is the speech-engine transcript, so Show original still works. With a real key, a model rewrite runs after the dictionary pass. The prompt tells the model not to invent facts and not to change numbers, part numbers, or measurements. If that call fails, the dictionary-corrected text is used.

A technician can suggest a spelling from the visit. It stays out of dictation until office or admin accepts it. Office and admin can add, edit, and remove terms in settings, the REST API, and the MCP tools `list_terms`, `create_term`, `update_term`, `delete_term`, and `suggest_term`.

Each person has a dictation default of English or Spanish. The Dictate control also has an English / Spanish switch for this browser session; that switch does not change the saved default until they choose Save as my default. Spanish is recognized as `es-US`. English stays `en-US`. When a cleanup key is configured, Spanish is translated into English in the same pass that cleans the note. The prompt still forbids invented facts and changed numbers, and dictionary spellings apply to the English result. Show original keeps the Spanish transcript. The note stores that source language. With no cleanup key, the field keeps the Spanish words and shows Not translated. It is not presented as an English translation.

### Location on company phones

Office opens `/map` for each technician's last position, today's trail, job pins, and an en-route ETA. The map is Leaflet on OpenStreetMap tiles, so it does not need a paid key. Phones post batches to `POST /api/v1/locations` with a device token (`adeldev_…`), which is separate from a user API token. Tracking runs only during the hours in Settings, only after the technician acknowledges the written notice, and there is no covert mode. The web app reports only while the screen is in use. `companion/` is the later always-on path for a managed company phone. It is not submitted to an app store.

Arrival inside 150 meters can set the visit to on site. Leaving records a departure and does not complete the visit. If notes or photos are still missing, the technician gets one in-app reminder after a short grace (default 2 minutes). Re-entering the site during that wait cancels it. The reminder is on by default. Details, MDM, and battery notes are in [docs/company-phone-location.md](docs/company-phone-location.md).

**Company policy point for counsel review. This is not legal advice.**

## Assumptions (v1)

- Adel Electric and Service Contracts are two companies in one database. They share the servers, the office desk, and the tech phone app. Their books stay separate. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- Default tax is 7% (700 basis points), labeled as an estimate. Materials are taxable. Labor is not. The rate is snapshotted onto each estimate and invoice.
- The shop clock is `America/New_York`. `America/Chicago` is the other option in settings.
- The office can approve a draft or a sent estimate in person. A customer can approve or decline only from the link, and only while the estimate is sent and inside 30 days.
- The app does not email or text that link.
- Visit statuses are `scheduled`, `en_route`, `on_site`, `completed`, and `canceled`.
- Technicians see only their assigned visits. Completing a visit requires a PNG signature and any required checklist items. Office and admin can complete without those.
- One non-void invoice per job. Issued invoices are due in 15 days. A card payment collects the remaining balance. Check, cash, and other payments are office or admin, and can be partial.
- A technician can start a card payment only on an invoice for a job they are assigned to.
- API tokens do not expire until they are revoked. A technician token is tied to that technician.

What is deferred is listed in [ROADMAP.md](ROADMAP.md).
