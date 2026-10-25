import { Empty, PageHeader, StatusPill, TextLink } from "@/components/ui";
import { invoiceNo } from "@/lib/format";
import { listInvoices } from "@adel/core";
import { requireOffice } from "@/server/session";
import Link from "next/link";

const filters = ["", "draft", "issued", "partial", "paid", "void"];

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const actor = await requireOffice();
  const query = await searchParams;
  const { data } = await listInvoices(actor, { status: query.status });
  return (
    <div>
      <PageHeader title="Invoices" lede="Draft from a job, issue it, then take a card or record a check." />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        {filters.map((status) => (
          <Link key={status || "all"} className="rounded-full border border-line bg-card px-3 py-1" href={status ? `/invoices?status=${status}` : "/invoices"}>
            {status || "All"}
          </Link>
        ))}
      </div>
      {data.length === 0 ? <Empty>No invoices in this view.</Empty> : null}
      <ul className="divide-y divide-line rounded-lg border border-line bg-card">
        {data.map((row) => (
          <li key={row.id} className="flex items-center justify-between gap-2 px-4 py-3 text-sm">
            <TextLink href={`/invoices/${row.id}`}>{invoiceNo(row.number)}</TextLink>
            <span className="text-muted">{row.customerName}</span>
            <StatusPill status={row.status} />
          </li>
        ))}
      </ul>
    </div>
  );
}
