# Later

These are intentionally out of v1. The desk, the field web app, invoices, test-mode card payments, and the API are the foundation they would sit on.

## Native mobile apps

Technicians install the web app on a phone today (Add to Home Screen). A native iOS and Android app would add a reliable offline queue for notes, photos, and time entries when a job site has no signal, plus push when the office moves a visit.

## Books

Each company keeps its own ledger in Adel Service: invoices, payments, and intercompany bills, plus receivables aging, revenue by month, payments received, and the balance between the companies. CSV and Excel exports are the handoff to an accountant. A QuickBooks sandbox plug-in exists and stays off unless `ACCOUNTING_PROVIDER=quickbooks`. See [docs/books.md](docs/books.md).

## AI receptionist

An assistant that answers the shop phone, logs a request against the right customer and property, and drafts an estimate for the office to send. The REST API, webhooks, and MCP server are the hooks for that. It is not built here.

## Service contracts, still one company on this desk

Adel Electric and Service Contracts already keep separate books. These contract features stay unbuilt until someone picks them up. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

- Recurring visit plans for a contract
- Renewal reminders before a contract end date
- Contract billing: a monthly or annual flat fee, and a way to tell covered labor from labor that is billed extra
- Intercompany billing is in place for shared labor, materials, and other charges. Rates are configurable. The supplier's book gets an invoice and the consumer's book gets a bill, linked without a foreign key. See [docs/books.md](docs/books.md).

## Other gaps left on purpose

- Email and SMS delivery of estimates and invoices (the app mints a customer link; it does not send it)
- Tax rules beyond one company-wide rate, with labor and materials flagged per line
- Inventory, purchase orders, and recurring maintenance plans
- A customer portal beyond the single estimate link
