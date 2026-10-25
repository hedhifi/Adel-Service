import { Empty, PageHeader, Panel, StatusPill, TextLink, buttonClass } from "@/components/ui";
import { billingLabel, money } from "@/lib/format";
import { renewContractAction } from "@/server/actions";
import { requireOffice } from "@/server/session";
import { listContracts, listUpcomingRenewals, maintainServiceContracts } from "@adel/core";
import Link from "next/link";

export default async function ContractsPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const actor = await requireOffice();
  const query = await searchParams;
  await maintainServiceContracts(actor);
  const [{ data }, renewals] = await Promise.all([listContracts(actor), listUpcomingRenewals(actor)]);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Service contracts"
        lede="Recurring visits and flat-fee billing for this company. Opening this page fills the dispatch horizon, issues invoices that are due, and renews or lapses contracts whose end date has arrived."
        action={
          <Link className={buttonClass} href="/contracts/new">
            New contract
          </Link>
        }
      />
      {query.error ? <p className="text-sm text-danger">{query.error}</p> : null}
      {query.notice ? <p className="text-sm text-ok">{query.notice}</p> : null}
      <Panel>
        <h2 className="mb-3 font-serif text-xl">Coming up for renewal</h2>
        {renewals.data.length === 0 ? <Empty>No active contracts end inside the reminder window.</Empty> : null}
        <ul className="space-y-3">
          {renewals.data.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <div>
                <TextLink href={`/contracts/${row.id}`}>{row.title || "Service contract"}</TextLink>
                <p className="text-muted">
                  {row.customerName} · ends {row.endsOn} · {row.daysLeft} days · {money(row.priceCents)} {billingLabel(row.billingFrequency).toLowerCase()}
                  {row.autoRenew ? " · renews on its own" : ""}
                </p>
              </div>
              <form action={renewContractAction} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="id" value={row.id} />
                <input type="hidden" name="returnTo" value="/contracts" />
                <input className="w-28 rounded-md border border-line bg-card px-2 py-1" name="price" inputMode="decimal" placeholder="New price" aria-label={`New price for ${row.customerName}`} />
                <button className={buttonClass} type="submit">
                  Renew
                </button>
              </form>
            </li>
          ))}
        </ul>
      </Panel>
      {data.length === 0 ? <Empty>No contracts in this company yet.</Empty> : null}
      <ul className="divide-y divide-line rounded-lg border border-line bg-card">
        {data.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div>
              <TextLink href={`/contracts/${row.id}`}>{row.title || row.customerName}</TextLink>
              <p className="text-sm text-muted">
                {row.customerName} · {row.propertyLabel} · {money(row.priceCents)} {billingLabel(row.billingFrequency, row.billingIntervalCount).toLowerCase()}
                {row.endsOn ? ` · through ${row.endsOn}` : ""}
              </p>
            </div>
            <StatusPill status={row.status} />
          </li>
        ))}
      </ul>
    </div>
  );
}
