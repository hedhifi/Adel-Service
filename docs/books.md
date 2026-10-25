# Books

Adel Electric and Service Contracts each keep their own books inside Adel Service. Invoices, payments, products, and bills live on that company's rows. A charge between them becomes an invoice in the supplying company's book and a bill in the consuming company's book. Those two documents are tied through the link layer (`entity_links`), not a foreign key.

The office desk for a company shows:

- A ledger (debits and credits for invoices, payments, and intercompany bills)
- Accounts receivable aging (current, 1–30, 31–60, 61–90, 91+)
- Revenue by month, with homeowner revenue and intercompany revenue apart
- Payments received
- The balance between the two companies

**Excel workbook** and **CSV** downloads are the file an accountant uses. Amounts are dollars. One download contains only the company you are working in.

Stripe stays in test mode and is not a book entry until a payment succeeds.

## Between the companies

Rates are set by someone who belongs to both companies. A technician from Adel Electric on a Service Contracts visit is charged at the labor rate. Shared materials use their own rate. Generating the charges writes the invoice and the bill, tax zero, due in 15 days. Settlement records a payment on the invoice and a bill payment on the bill. The reconciliation page shows what each side still owes, and whether the two amounts match.

## What would fit later

The workbook is a normal import for a package Adel might pick up later. Any of these can take the CSV or the Excel file without a live connection:

- **QuickBooks Online**, if Adel wants the books in Intuit. Use one company file per partition.
- **Xero**, a common choice when a second company has an outside partner and needs its own file.
- **Wave**, enough for a small service company that mostly needs invoices, payments, and a CSV import.

Do not put both partitions in one outside file. The split only stays clean if each company imports its own export.

## Optional QuickBooks plug-in

Direct sync is off. Adel Service is the book of record. The plug-in remains in the app for a sandbox trial and does nothing until the server sets:

```
ACCOUNTING_PROVIDER=quickbooks
QBO_ENVIRONMENT=sandbox
QBO_PROVIDER=mock
```

`QBO_PROVIDER=intuit` also needs Development keys (not Production keys), `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, and `QBO_REDIRECT_URI` pointed at `/api/v1/qbo/oauth/callback`. Create two Intuit sandbox companies and connect each partition to a different one. The production host and live-looking keys are refused. Turning the plug-in on does not replace the ledger or the exports.
