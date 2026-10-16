import { Flash, PageHeader, StatusPill, TextLink, buttonClass, ghostClass, inputClass } from "@/components/ui";
import { LineItemsEditor } from "@/components/line-items-editor";
import { address, jobNo, when } from "@/lib/format";
import { createInvoiceAction, scheduleVisitAction, updateJobAction } from "@/server/actions";
import { requireOffice } from "@/server/session";
import { companyToday } from "@adel/db/zoned";
import { getCompanySettings, getJob, listFormTemplates, listUsers } from "@adel/core";

export default async function JobPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const actor = await requireOffice();
  const { id } = await params;
  const query = await searchParams;
  const [{ data }, settings, people, forms] = await Promise.all([
    getJob(actor, id),
    getCompanySettings(),
    listUsers(actor),
    listFormTemplates(actor),
  ]);
  const techs = people.data.filter((person) => person.role === "tech" && person.active);
  const today = companyToday(settings.timeZone);
  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader title={`${jobNo(data.number)} ${data.title}`} lede={`${data.customerName} · ${data.brandName}`} action={<StatusPill status={data.status} />} />
      <Flash error={query.error} notice={query.notice} />
      <p className="text-sm">{address({ line1: data.line1, city: data.city, state: data.state, postalCode: data.postalCode })}</p>
      {data.accessNotes ? <p className="text-sm text-muted">{data.accessNotes}</p> : null}
      <form action={updateJobAction} className="space-y-2">
        <input type="hidden" name="id" value={id} />
        <textarea className={inputClass} name="instructions" rows={3} defaultValue={data.instructions ?? ""} placeholder="Instructions for the crew" />
        <button className={ghostClass} type="submit">
          Save instructions
        </button>
      </form>
      <section>
        <h2 className="mb-2 font-serif text-2xl">Visits</h2>
        <ul className="mb-3 space-y-2 text-sm">
          {data.visits.map((visit) => (
            <li key={visit.id} className="flex flex-wrap items-center justify-between gap-2">
              <TextLink href={`/tech/visits/${visit.id}`}>
                {when(visit.scheduledStart, settings.timeZone)} · {visit.technicianName ?? "Unassigned"}
              </TextLink>
              <StatusPill status={visit.status} />
            </li>
          ))}
        </ul>
        <form action={scheduleVisitAction} className="grid gap-3 rounded-lg border border-line bg-card p-4 md:grid-cols-2">
          <input type="hidden" name="jobId" value={id} />
          <label className="text-sm">
            Day
            <input className={inputClass} type="date" name="day" required defaultValue={today} />
          </label>
          <label className="text-sm">
            Technician
            <select className={inputClass} name="technicianId" defaultValue={techs[0]?.id ?? ""}>
              <option value="">Unassigned</option>
              {techs.map((tech) => (
                <option key={tech.id} value={tech.id}>
                  {tech.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Start
            <input className={inputClass} type="time" name="start" required defaultValue="09:00" />
          </label>
          <label className="text-sm">
            End
            <input className={inputClass} type="time" name="end" required defaultValue="12:00" />
          </label>
          <label className="text-sm md:col-span-2">
            Form
            <select className={inputClass} name="formTemplateId" defaultValue="">
              <option value="">No form</option>
              {forms.data.map((form) => (
                <option key={form.id} value={form.id}>
                  {form.name}
                </option>
              ))}
            </select>
          </label>
          <button className={buttonClass} type="submit">
            Schedule visit
          </button>
        </form>
      </section>
      <section className="space-y-3">
        <h2 className="font-serif text-2xl">Invoice</h2>
        {data.invoice ? (
          <TextLink href={`/invoices/${data.invoice.id}`}>INV-{data.invoice.number}</TextLink>
        ) : (
          <form action={createInvoiceAction} className="space-y-3">
            <input type="hidden" name="jobId" value={id} />
            {data.quoteId ? <p className="text-sm text-muted">Leave the lines blank to copy the estimate.</p> : <LineItemsEditor />}
            <button className={buttonClass} type="submit">
              Draft invoice
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
