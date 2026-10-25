import { BrandChip, Empty, Flash, PageHeader, Panel, StatusPill, TextLink } from "@/components/ui";
import { billingLabel, dayLabel, invoiceNo, jobNo, money, quoteNo, when } from "@/lib/format";
import { renewContractAction } from "@/server/actions";
import { getDashboard, maintainServiceContracts } from "@adel/core";
import { requireOffice } from "@/server/session";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const actor = await requireOffice();
  const query = await searchParams;
  await maintainServiceContracts(actor);
  const { data } = await getDashboard(actor);
  return (
    <div className="space-y-6">
      <PageHeader title={dayLabel(data.day, data.timeZone)} lede={`${data.company}. What's waiting on the office.`} />
      <Flash error={query.error} notice={query.notice} />
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ["New requests", data.counts.newRequests],
          ["Estimates out", data.counts.quotesOut],
          ["Open invoices", data.counts.invoicesOpen],
          ["Stops today", data.counts.visitsToday],
        ].map(([label, value]) => (
          <Panel key={String(label)}>
            <p className="text-sm text-muted">{label}</p>
            <p className="font-serif text-3xl">{value}</p>
          </Panel>
        ))}
      </div>
      <Panel>
        <h2 className="mb-3 font-serif text-xl">Contracts up for renewal</h2>
        {data.upcomingRenewals.length === 0 ? <Empty>No contracts in this company end soon.</Empty> : null}
        <ul className="space-y-3">
          {data.upcomingRenewals.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <div>
                <TextLink href={`/contracts/${row.id}`}>{row.title || row.customerName}</TextLink>
                <p className="text-muted">
                  {row.customerName} · ends {row.endsOn} · {money(row.priceCents)} {billingLabel(row.billingFrequency).toLowerCase()}
                  {row.autoRenew ? " · renews on its own" : ` · ${row.daysLeft} days left`}
                </p>
              </div>
              <form action={renewContractAction} className="flex items-center gap-2">
                <input type="hidden" name="id" value={row.id} />
                <input type="hidden" name="returnTo" value="/" />
                <input className="w-28 rounded-md border border-line bg-card px-2 py-1" name="price" inputMode="decimal" placeholder="New price" aria-label={`New price for ${row.customerName}`} />
                <button className="inline-flex items-center justify-center rounded-md bg-pine px-3 py-2 text-sm font-semibold text-white" type="submit">
                  Renew
                </button>
              </form>
            </li>
          ))}
        </ul>
      </Panel>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <h2 className="mb-3 font-serif text-xl">Requests to look at</h2>
          {data.openRequests.length === 0 ? <Empty>No open requests.</Empty> : null}
          <ul className="space-y-2">
            {data.openRequests.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-2 text-sm">
                <TextLink href={`/requests/${row.id}`}>{row.title}</TextLink>
                <span className="text-muted">{row.customerName}</span>
                <StatusPill status={row.status} />
              </li>
            ))}
          </ul>
        </Panel>
        <Panel>
          <h2 className="mb-3 font-serif text-xl">Estimates waiting</h2>
          {data.sentQuotes.length === 0 ? <Empty>Nothing is out for a decision.</Empty> : null}
          <ul className="space-y-2 text-sm">
            {data.sentQuotes.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-2">
                <TextLink href={`/quotes/${row.id}`}>
                  {quoteNo(row.number)} {row.title}
                </TextLink>
                <span className="text-muted">{row.customerName}</span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel>
          <h2 className="mb-3 font-serif text-xl">On the board today</h2>
          {data.today.length === 0 ? <Empty>No visits scheduled today.</Empty> : null}
          <ul className="space-y-2 text-sm">
            {data.today.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2">
                <TextLink href={`/tech/visits/${row.id}`}>
                  {when(row.scheduledStart, data.timeZone)} · {row.customerName}
                </TextLink>
                <BrandChip name={row.brandName} />
                <StatusPill status={row.status} />
              </li>
            ))}
          </ul>
        </Panel>
        <Panel>
          <h2 className="mb-3 font-serif text-xl">Money outstanding</h2>
          {data.openInvoices.length === 0 ? <Empty>No issued invoices are waiting.</Empty> : null}
          <ul className="space-y-2 text-sm">
            {data.openInvoices.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-2">
                <TextLink href={`/invoices/${row.id}`}>
                  {invoiceNo(row.number)} {row.customerName}
                </TextLink>
                <StatusPill status={row.status} />
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      <p className="text-xs text-muted">Job numbers look like {jobNo(1001)}. Estimates and invoices use the same idea.</p>
    </div>
  );
}
