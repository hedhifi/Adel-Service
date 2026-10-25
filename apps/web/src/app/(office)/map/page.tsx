import { LiveMap } from "@/components/live-map";
import { PageHeader } from "@/components/ui";
import { requireOffice } from "@/server/session";
import { LOCATION_NOTICE, getLiveMap } from "@adel/core";

export default async function MapPage() {
  const actor = await requireOffice();
  const { data } = await getLiveMap(actor);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Live map"
        lede="Company phones, during tracking hours, after each technician acknowledges the written notice. No covert mode."
      />
      <p className="text-sm text-muted">{LOCATION_NOTICE.counselLabel}</p>
      <LiveMap techs={data.techs} jobs={data.jobs} />
      <ul className="grid gap-2 text-sm md:grid-cols-2">
        {data.techs.map((tech) => (
          <li key={tech.id} className="rounded-md border border-line bg-card px-3 py-2">
            <p className="font-semibold">{tech.name}</p>
            <p className="text-muted">{tech.last ? `${tech.last.freshness} · battery ${tech.last.batteryPercent}%` : "No position today"}</p>
          </li>
        ))}
        {data.jobs.map((job) => (
          <li key={job.visitId} className="rounded-md border border-line bg-card px-3 py-2">
            <p className="font-semibold">{job.customerName}</p>
            <p className="text-muted">
              {job.status.replaceAll("_", " ")}
              {job.etaMinutes ? ` · about ${job.etaMinutes} min by straight line` : ""}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
