import { PageHeader, Panel, ghostClass } from "@/components/ui";
import { money } from "@/lib/format";
import { getBooks, quickBooksPluginEnabled } from "@adel/core";
import { requireOffice } from "@/server/session";
import Link from "next/link";

const buckets = ["current", "1-30", "31-60", "61-90", "91+"] as const;

export default async function BooksPage() {
  const actor = await requireOffice();
  const { data } = await getBooks(actor);
  const plugin = quickBooksPluginEnabled();
  const agingTotals = Object.fromEntries(buckets.map((bucket) => [bucket, data.aging.filter((row) => row.bucket === bucket).reduce((sum, row) => sum + row.balanceCents, 0)])) as Record<
    (typeof buckets)[number],
    number
  >;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Books"
        lede={`${data.companyName} keeps its own ledger. Invoices, payments, and charges between the companies stay in this book. Nothing here is written to the other company.`}
        action={
          <div className="flex flex-wrap gap-2">
            <a className={ghostClass} href="/api/v1/books/export?report=workbook&format=xlsx">
              Excel workbook
            </a>
            <Link className={ghostClass} href="/books/items">
              Products
            </Link>
            <Link className={ghostClass} href="/intercompany">
              Between companies
            </Link>
          </div>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Panel>
          <p className="text-sm text-muted">Open receivables</p>
          <p className="font-serif text-3xl">{money(data.openReceivableCents)}</p>
          <p className="text-sm text-muted">As of {data.asOf}</p>
        </Panel>
        <Panel>
          <p className="text-sm text-muted">Revenue this month</p>
          <p className="font-serif text-3xl">{money(data.revenueThisMonthCents)}</p>
        </Panel>
        <Panel>
          <p className="text-sm text-muted">Payments this month</p>
          <p className="font-serif text-3xl">{money(data.paymentsThisMonthCents)}</p>
        </Panel>
        <Panel>
          <p className="text-sm text-muted">Intercompany net</p>
          <p className="font-serif text-3xl">{money(data.intercompany.netCents)}</p>
          <p className="text-sm text-muted">
            Owed to us {money(data.intercompany.receivableCents)} · We owe {money(data.intercompany.payableCents)}
          </p>
        </Panel>
      </div>
      <Panel>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <h2 className="font-serif text-xl">Accounts receivable aging</h2>
          <a className="text-sm text-pine underline-offset-2 hover:underline" href="/api/v1/books/export?report=aging&format=csv">
            Download CSV
          </a>
        </div>
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {buckets.map((bucket) => (
            <div key={bucket} className="rounded-md border border-line px-3 py-2">
              <p className="text-xs uppercase tracking-wide text-muted">{bucket === "current" ? "Current" : `${bucket} days`}</p>
              <p className="font-semibold">{money(agingTotals[bucket])}</p>
            </div>
          ))}
        </div>
        {data.aging.length === 0 ? <p className="text-sm text-muted">No open invoices.</p> : null}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-muted">
              <tr>
                <th className="py-1 pr-3 font-medium">Invoice</th>
                <th className="py-1 pr-3 font-medium">Customer</th>
                <th className="py-1 pr-3 font-medium">Due</th>
                <th className="py-1 pr-3 font-medium">Balance</th>
                <th className="py-1 font-medium">Bucket</th>
              </tr>
            </thead>
            <tbody>
              {data.aging.map((row) => (
                <tr key={row.number} className="border-t border-line">
                  <td className="py-2 pr-3">INV-{row.number}</td>
                  <td className="py-2 pr-3">{row.customer}</td>
                  <td className="py-2 pr-3">{row.dueOn}</td>
                  <td className="py-2 pr-3">{money(row.balanceCents)}</td>
                  <td className="py-2">{row.bucket}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <div className="mb-3 flex items-end justify-between gap-2">
            <h2 className="font-serif text-xl">Revenue</h2>
            <a className="text-sm text-pine underline-offset-2 hover:underline" href="/api/v1/books/export?report=revenue&format=csv">
              CSV
            </a>
          </div>
          {data.revenue.length === 0 ? <p className="text-sm text-muted">No issued invoices in this range.</p> : null}
          <ul className="divide-y divide-line text-sm">
            {data.revenue.map((row) => (
              <li key={row.period} className="flex justify-between gap-3 py-2">
                <span>{row.period}</span>
                <span>
                  {money(row.serviceRevenueCents + row.intercompanyRevenueCents)}
                  {row.intercompanyRevenueCents ? <span className="block text-right text-muted">Includes {money(row.intercompanyRevenueCents)} between companies</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel>
          <div className="mb-3 flex items-end justify-between gap-2">
            <h2 className="font-serif text-xl">Payments received</h2>
            <a className="text-sm text-pine underline-offset-2 hover:underline" href="/api/v1/books/export?report=payments&format=csv">
              CSV
            </a>
          </div>
          {data.payments.length === 0 ? <p className="text-sm text-muted">No payments in this range.</p> : null}
          <ul className="divide-y divide-line text-sm">
            {data.payments.map((row) => (
              <li key={`${row.date}-${row.document}-${row.reference}`} className="flex justify-between gap-3 py-2">
                <span>
                  {row.party}
                  <span className="block text-muted">
                    {row.date} · {row.document} · {row.method}
                    {row.reference ? ` · ${row.reference}` : ""}
                  </span>
                </span>
                <span>{money(row.amountCents)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      <Panel>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <h2 className="font-serif text-xl">Ledger</h2>
          <a className="text-sm text-pine underline-offset-2 hover:underline" href="/api/v1/books/export?report=ledger&format=csv">
            Download CSV
          </a>
        </div>
        <p className="mb-3 text-sm text-muted">Each invoice, payment, and intercompany bill is posted in this company only. Debits and credits are dollars an accountant can import.</p>
        {data.ledger.length === 0 ? <p className="text-sm text-muted">Nothing posted yet.</p> : null}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-muted">
              <tr>
                <th className="py-1 pr-3 font-medium">Date</th>
                <th className="py-1 pr-3 font-medium">Document</th>
                <th className="py-1 pr-3 font-medium">Party</th>
                <th className="py-1 pr-3 font-medium">Account</th>
                <th className="py-1 pr-3 font-medium">Debit</th>
                <th className="py-1 font-medium">Credit</th>
              </tr>
            </thead>
            <tbody>
              {data.ledger.map((row, index) => (
                <tr key={`${row.date}-${row.document}-${row.account}-${index}`} className="border-t border-line">
                  <td className="py-2 pr-3">{row.date}</td>
                  <td className="py-2 pr-3">{row.document}</td>
                  <td className="py-2 pr-3">{row.party}</td>
                  <td className="py-2 pr-3">{row.account}</td>
                  <td className="py-2 pr-3">{row.debitCents ? money(row.debitCents) : ""}</td>
                  <td className="py-2">{row.creditCents ? money(row.creditCents) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <p className="text-sm text-muted">
        {plugin
          ? "The QuickBooks sandbox plug-in is on for this server. The ledger above is still the book of record."
          : "No accounting package is connected. The Excel workbook is the file to give an accountant, or to import later into QuickBooks, Xero, or Wave."}{" "}
        {plugin ? (
          <Link className="text-pine underline-offset-2 hover:underline" href="/books/quickbooks">
            Open the QuickBooks plug-in
          </Link>
        ) : null}
      </p>
    </div>
  );
}
