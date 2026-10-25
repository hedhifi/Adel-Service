# Integrated now, separable later

Added 2026-10-16. Applies to every Adel Service business feature from the entity partition onward.

Adel Electric (project electrical work) and Service Contracts share infrastructure to save money: the same servers, database cluster, tech phone app, office dashboard, and dispatch board. Their data, billing, and books stay separable from day one so a future split into two corporations needs no rewrite.

## Rules

- Every business record is scoped to exactly one entity.
- Invoices, payments, numbering, tax, Stripe accounts, API tokens, webhooks, and accounting exports are per entity.
- No foreign key and no query crosses entities except through an explicit, documented link layer.
- A person who is a customer of both entities has a separate customer record in each. An optional cross-entity link table may connect those records. Either side can be exported without the other.
- Shared dispatch and the tech app show both entities’ visits with clear labels. Every write lands in exactly one entity.
- Each entity has an export/extract path, or a written extract design, that proves the books can leave without the other entity.
- Tests must fail the build if a token, session, or query for one entity can read or write the other, including API and MCP.

## Follow-ups (do not build yet)

- Recurring visit plans
- Renewal reminders
- Contract billing: monthly or annual flat fee, and covered versus non-covered labor
- Intercompany billing for shared resources. When Adel Electric’s office staff, techs, or shared infrastructure do work for the Service Contracts entity, record it and let the office generate internal invoices from one entity to the other (labor hours by rate, and shared-cost allocations). Each side keeps the invoice in its own books. The companies can settle up, and a future split keeps that history. Invoices still cross only through the documented link layer.

## Where this stops

Sharing a server, a database cluster, or a UI is allowed. Merging the books is not. This principle does not require a second deployment now, and it does not pull recurring visits, renewals, contract billing, or intercompany billing into the current pass.

A later split is a separate database and a separate deployment. Copy the one entity’s rows and its link-layer endpoints. Leave the other entity behind. User login may stay shared; business data may not.

## How this build follows the principle

Adel Electric and Service Contracts are rows in `entities`. Customers, properties, requests, estimates, jobs, visits, invoices, contracts, brands, numbering counters, tax rates, Stripe account ids, API tokens, and webhook endpoints each carry `entity_id`. A basic contract is a customer, a property, a start, an end, a status, and notes. It does not bill.

The active company on a session is where new customers, jobs, invoices, and contracts are written. Lists of those books show that company only. An API token is minted for one company and cannot switch. MCP tools call the same HTTP routes with that one bearer token, so they see one company.

Shared dispatch (`/schedule` for a signed-in office session) and the tech app list visits for every company the person belongs to, each labeled with the company name. A token does not get that combined list. Opening a visit does not move it into the other company.

`entity_links` is the link layer. It stores two company ids and two record ids. Those record ids are not foreign keys. `GET /api/v1/entities/export` returns one company’s rows plus the link endpoints that mention it, and nothing from the other company’s books.

User login, the speech dictionary, device tokens, location points, and the tracking-hours policy stay shared. They are not books. Geofence rows point at one visit, which already belongs to one company.

The receptionist is per company. `receptionist_settings`, `receptionist_conversations`, and `receptionist_sandbox_messages` each carry `entity_id`. Messages hang off one conversation. A phone line or website widget names one company (`adel-electric` or `service-contracts`) before the first write. Customer and property matching reads that company only. The request, the job, and the tentative visit are inserted with that same `entity_id`. Nothing in the flow writes a second copy into the other company. Open slots are gaps on that company's own visits, the rows dispatch shows for that company. They do not read the other company's customers or visits. The office log and settings follow the active company, and every log row shows that company's name. Export includes that company's receptionist settings, conversations, messages, and sandbox outbox.

## What a later split copies

Copy that company’s `entities` row, its memberships, and every business table filtered by `entity_id`, including child rows that hang off those parents (line items, payments, notes, photos, checklist answers). Copy `entity_links` rows that name that company, keeping the other side as an endpoint id. Leave the other company’s rows in the old database.

User accounts can stay in a shared login service. Business rows do not. The app deploy for the new company gets its own database and its own Stripe account. Future features, including intercompany billing, have to keep using the link layer instead of a foreign key into the other company’s tables.
