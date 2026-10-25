# Later

These are intentionally out of v1. The desk, the field web app, invoices, test-mode card payments, and the API are the foundation they would sit on.

## Native mobile apps

Technicians install the web app on a phone today (Add to Home Screen). A native iOS and Android app would add a reliable offline queue for notes, photos, and time entries when a job site has no signal, plus push when the office moves a visit.

## QuickBooks sync

Invoices and payments stay in Adel Service. A later sync would push issued invoices and received payments into the company QuickBooks file and pull payment status back. It should not become a second ledger inside this app.

## AI receptionist

An assistant that answers the shop phone, logs a request against the right customer and property, and drafts an estimate for the office to send. The REST API, webhooks, and MCP server are the hooks for that. It is not built here.

## Service contracts

Recurring visit plans, renewal reminders, and flat-fee billing are in the app for whichever company owns the contract. Included work is the contract scope. Extra work is a separate job and a separate invoice. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

Still unbuilt:

- Intercompany billing for shared resources. When Adel Electric’s office staff, technicians, or shared infrastructure do work for Service Contracts, record it and let the office generate an internal invoice from one company to the other (labor hours by rate, and shared-cost allocations). Each invoice stays in the company that issued it and in the company that received it, so they can settle up and a future split keeps that history. Those invoices cross only through the documented link layer.

## Other gaps left on purpose

- Email and SMS delivery of estimates and invoices (the app mints a customer link; it does not send it)
- Tax rules beyond one company-wide rate, with labor and materials flagged per line
- Inventory, purchase orders, and recurring maintenance plans
- A customer portal beyond the single estimate link
