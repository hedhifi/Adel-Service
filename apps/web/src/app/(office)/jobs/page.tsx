import { Empty, PageHeader, StatusPill, TextLink, buttonClass } from "@/components/ui";
import { jobNo } from "@/lib/format";
import { listJobs } from "@adel/core";
import { requireOffice } from "@/server/session";
import Link from "next/link";

const filters = ["", "unscheduled", "scheduled", "in_progress", "completed", "canceled"];

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const actor = await requireOffice();
  const query = await searchParams;
  const { data } = await listJobs(actor, { status: query.status });
  return (
    <div>
      <PageHeader
        title="Jobs"
        lede="Work we have agreed to do. Schedule visits from the job."
        action={
          <Link className={buttonClass} href="/jobs/new">
            New job
          </Link>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        {filters.map((status) => (
          <Link key={status || "all"} className="rounded-full border border-line bg-card px-3 py-1" href={status ? `/jobs?status=${status}` : "/jobs"}>
            {status.replaceAll("_", " ") || "All"}
          </Link>
        ))}
      </div>
      {data.length === 0 ? <Empty>No jobs in this view.</Empty> : null}
      <ul className="divide-y divide-line rounded-lg border border-line bg-card">
        {data.map((row) => (
          <li key={row.id} className="flex items-center justify-between gap-2 px-4 py-3 text-sm">
            <TextLink href={`/jobs/${row.id}`}>
              {jobNo(row.number)} {row.title}
            </TextLink>
            <span className="text-muted">
              {row.customerName} · {row.city}
            </span>
            <StatusPill status={row.status} />
          </li>
        ))}
      </ul>
    </div>
  );
}
