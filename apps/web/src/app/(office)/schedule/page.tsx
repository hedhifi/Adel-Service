import { BrandChip, PageHeader, StatusPill, ghostClass, inputClass } from "@/components/ui";
import { dayLabel, when } from "@/lib/format";
import { reassignVisitAction } from "@/server/actions";
import { requireOffice } from "@/server/session";
import { shiftDay } from "@adel/db/zoned";
import { getSchedule } from "@adel/core";
import Link from "next/link";

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ day?: string; error?: string }> }) {
  const actor = await requireOffice();
  const query = await searchParams;
  const { data } = await getSchedule(actor, query.day);
  const columns = [
    { id: "", name: "Unassigned" },
    ...data.technicians.map((tech) => ({ id: tech.id, name: tech.name })),
  ];
  return (
    <div>
      <PageHeader title="Dispatch" lede={dayLabel(data.day, data.timeZone)} />
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <Link className={ghostClass} href={`/schedule?day=${shiftDay(data.day, -1)}`}>
          Previous
        </Link>
        <Link className={ghostClass} href="/schedule">
          Today
        </Link>
        <Link className={ghostClass} href={`/schedule?day=${shiftDay(data.day, 1)}`}>
          Next
        </Link>
      </div>
      {query.error ? <p className="mb-3 text-sm text-danger">{query.error}</p> : null}
      <div className="flex gap-3 overflow-x-auto pb-4">
        {columns.map((column) => {
          const visits = data.visits.filter((visit) => (visit.technicianId ?? "") === column.id);
          return (
            <section key={column.id || "none"} className="w-72 shrink-0 rounded-lg border border-line bg-card p-3">
              <h2 className="font-serif text-lg">{column.name}</h2>
              <p className="mb-3 text-xs text-muted">{visits.length} stops</p>
              <div className="space-y-3">
                {visits.map((visit) => (
                  <article key={visit.id} className="rounded-md border border-line p-3 text-sm">
                    <p className="font-semibold">
                      {when(visit.scheduledStart, data.timeZone)}–{when(visit.scheduledEnd, data.timeZone).split(", ").pop()}
                    </p>
                    <Link className="font-semibold text-pine" href={`/jobs/${visit.jobId}`}>
                      {visit.customerName}
                    </Link>
                    <p>{visit.jobTitle}</p>
                    <p className="text-muted">{visit.line1}</p>
                    <div className="mt-2 flex items-center justify-between">
                      <BrandChip name={visit.brandName} />
                      <StatusPill status={visit.status} />
                    </div>
                    <form action={reassignVisitAction} className="mt-2 flex gap-1">
                      <input type="hidden" name="id" value={visit.id} />
                      <input type="hidden" name="day" value={data.day} />
                      <select className={inputClass} name="technicianId" defaultValue={visit.technicianId ?? ""}>
                        <option value="">Unassigned</option>
                        {data.technicians.map((tech) => (
                          <option key={tech.id} value={tech.id}>
                            {tech.name}
                          </option>
                        ))}
                      </select>
                      <button className={ghostClass} type="submit">
                        Move
                      </button>
                    </form>
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
