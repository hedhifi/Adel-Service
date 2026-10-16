import { BrandChip, Empty, StatusPill } from "@/components/ui";
import { dayLabel, when } from "@/lib/format";
import { companyToday, shiftDay } from "@adel/db/zoned";
import { getCompanySettings, listNotifications, listVisits } from "@adel/core";
import { requireUser } from "@/server/session";
import Link from "next/link";

export default async function TechHome({ searchParams }: { searchParams: Promise<{ day?: string; forbidden?: string }> }) {
  const actor = await requireUser();
  const query = await searchParams;
  const settings = await getCompanySettings();
  const day = query.day || companyToday(settings.timeZone);
  const [{ data }, notices] = await Promise.all([listVisits(actor, { day }), listNotifications(actor)]);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-serif text-3xl">{actor.role === "tech" ? "Today's stops" : "Field view"}</h1>
        <p className="text-sm text-muted">{dayLabel(day, settings.timeZone)}</p>
      </div>
      {query.forbidden ? <p className="text-sm text-danger">That page is for the office.</p> : null}
      <div className="flex gap-3 text-sm font-semibold text-pine">
        <Link href={`/tech?day=${shiftDay(day, -1)}`}>Previous</Link>
        <Link href="/tech">Today</Link>
        <Link href={`/tech?day=${shiftDay(day, 1)}`}>Next</Link>
      </div>
      <p className="text-sm text-muted">Install Adel Service from the browser menu to keep it on your home screen.</p>
      {notices.data.length ? (
        <ul className="space-y-2">
          {notices.data.map((notice) => (
            <li key={notice.id}>
              <a className="block rounded-md border border-line bg-card px-3 py-2 text-sm font-semibold text-pine" href={notice.href}>
                {notice.body}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {data.length === 0 ? <Empty>Nothing is assigned for this day.</Empty> : null}
      <ul className="space-y-3">
        {data.map((visit) => (
          <li key={visit.id}>
            <Link href={`/tech/visits/${visit.id}`} className="block rounded-lg border border-line bg-card p-4">
              <p className="text-sm text-muted">{when(visit.scheduledStart, settings.timeZone)}</p>
              <p className="font-serif text-2xl">{visit.customerName}</p>
              <p className="text-sm">{visit.line1}</p>
              <p className="text-sm text-muted">{visit.jobTitle}</p>
              <div className="mt-2 flex items-center justify-between">
                <BrandChip name={visit.brandName} />
                <StatusPill status={visit.status} />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
