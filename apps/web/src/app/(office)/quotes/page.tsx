import { Empty, PageHeader, StatusPill, TextLink, buttonClass } from "@/components/ui";
import { quoteNo } from "@/lib/format";
import { listQuotes } from "@adel/core";
import { requireOffice } from "@/server/session";
import Link from "next/link";

const filters = ["", "draft", "sent", "approved", "declined"];

export default async function QuotesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const actor = await requireOffice();
  const query = await searchParams;
  const { data } = await listQuotes(actor, { status: query.status });
  return (
    <div>
      <PageHeader
        title="Estimates"
        lede="Price the work, send a private link, then open a job when it's approved."
        action={
          <Link className={buttonClass} href="/quotes/new">
            New estimate
          </Link>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        {filters.map((status) => (
          <Link key={status || "all"} className="rounded-full border border-line bg-card px-3 py-1" href={status ? `/quotes?status=${status}` : "/quotes"}>
            {status || "All"}
          </Link>
        ))}
      </div>
      {data.length === 0 ? <Empty>No estimates in this view.</Empty> : null}
      <ul className="divide-y divide-line rounded-lg border border-line bg-card">
        {data.map((row) => (
          <li key={row.id} className="flex items-center justify-between gap-2 px-4 py-3 text-sm">
            <TextLink href={`/quotes/${row.id}`}>
              {quoteNo(row.number)} {row.title}
            </TextLink>
            <span className="text-muted">{row.customerName}</span>
            <StatusPill status={row.status} />
          </li>
        ))}
      </ul>
    </div>
  );
}
