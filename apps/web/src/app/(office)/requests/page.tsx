import { BrandChip, Empty, PageHeader, StatusPill, TextLink, buttonClass } from "@/components/ui";
import { listRequests } from "@adel/core";
import { requireOffice } from "@/server/session";
import Link from "next/link";

const filters = ["", "new", "reviewing", "quoted", "closed", "canceled"];

export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const actor = await requireOffice();
  const query = await searchParams;
  const { data } = await listRequests(actor, { status: query.status });
  return (
    <div>
      <PageHeader
        title="Requests"
        lede="Inbound work before it becomes an estimate."
        action={
          <Link className={buttonClass} href="/requests/new">
            New request
          </Link>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        {filters.map((status) => (
          <Link key={status || "all"} className="rounded-full border border-line bg-card px-3 py-1" href={status ? `/requests?status=${status}` : "/requests"}>
            {status || "All"}
          </Link>
        ))}
      </div>
      {data.length === 0 ? <Empty>No requests in this view.</Empty> : null}
      <ul className="divide-y divide-line rounded-lg border border-line bg-card">
        {data.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
            <div>
              <TextLink href={`/requests/${row.id}`}>{row.title}</TextLink>
              <p className="text-muted">
                {row.customerName} · {row.city}
              </p>
            </div>
            <BrandChip name={row.brandName} />
            <StatusPill status={row.status} />
          </li>
        ))}
      </ul>
    </div>
  );
}
