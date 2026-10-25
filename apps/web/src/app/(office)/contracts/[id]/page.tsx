import { Field, Flash, PageHeader, Panel, StatusPill, TextLink, buttonClass, dangerClass, ghostClass, inputClass } from "@/components/ui";
import { billingLabel, invoiceNo, money, when } from "@/lib/format";
import {
  addEquipmentAction,
  cancelContractAction,
  createScheduleAction,
  removeEquipmentAction,
  renewContractAction,
  saveCoveredPropertiesAction,
  skipOccurrenceAction,
  updateContractTermsAction,
  updateScheduleAction,
} from "@/server/actions";
import { requireOffice } from "@/server/session";
import { getContract, listUsers, maintainServiceContracts } from "@adel/core";

export default async function ContractPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const actor = await requireOffice();
  const { id } = await params;
  const query = await searchParams;
  await maintainServiceContracts(actor);
  const [{ data }, people] = await Promise.all([getContract(actor, id), listUsers(actor)]);
  const techs = people.data.filter((person) => person.role === "tech" && person.active);
  const covered = new Set(data.coveredProperties.map((property) => property.id));
  const open = data.status === "active" || data.status === "lapsed";
  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader
        title={data.title || "Service contract"}
        lede={`${data.customerName} · ${money(data.priceCents)} ${billingLabel(data.billingFrequency, data.billingIntervalCount).toLowerCase()}`}
        action={<StatusPill status={data.status} />}
      />
      <Flash error={query.error} notice={query.notice} />
      {open ? (
        <Panel className="space-y-3">
          <h2 className="font-serif text-xl">{data.status === "lapsed" ? "Renew a lapsed contract" : "Renew"}</h2>
          <p className="text-sm text-muted">
            {data.endsOn ? `Current end date ${data.endsOn}. ` : ""}
            Leave the price blank to keep {money(data.priceCents)}. The new term is {data.renewalTermMonths} months unless you change it.
            {data.autoRenew ? " This contract also renews on its own." : ""}
          </p>
          <form action={renewContractAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="id" value={id} />
            <Field label="New price">
              <input className={inputClass} name="price" inputMode="decimal" placeholder={money(data.priceCents)} />
            </Field>
            <Field label="Months">
              <input className={inputClass} name="termMonths" type="number" min={1} max={60} placeholder={String(data.renewalTermMonths)} />
            </Field>
            <button className={buttonClass} type="submit">
              Renew
            </button>
          </form>
        </Panel>
      ) : null}
      <Panel>
        <h2 className="mb-3 font-serif text-xl">Terms</h2>
        <form action={updateContractTermsAction} className="space-y-3">
          <input type="hidden" name="id" value={id} />
          <Field label="Title">
            <input className={inputClass} name="title" defaultValue={data.title} />
          </Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Starts">
              <input className={inputClass} type="date" name="startsOn" required defaultValue={data.startsOn} />
            </Field>
            <Field label="Ends">
              <input className={inputClass} type="date" name="endsOn" defaultValue={data.endsOn ?? ""} />
            </Field>
            <Field label="Price each bill">
              <input className={inputClass} name="price" required defaultValue={(data.priceCents / 100).toFixed(2)} />
            </Field>
            <Field label="Billing">
              <select className={inputClass} name="billingFrequency" defaultValue={data.billingFrequency}>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annual">Annual</option>
                <option value="custom">Custom months</option>
              </select>
            </Field>
            <Field label="Months between bills (custom)">
              <input className={inputClass} type="number" name="billingIntervalCount" min={1} max={36} defaultValue={data.billingIntervalCount} />
            </Field>
            <Field label="Renewal term (months)">
              <input className={inputClass} type="number" name="renewalTermMonths" min={1} max={60} defaultValue={data.renewalTermMonths} />
            </Field>
            <Field label="Reminder days">
              <input className={inputClass} type="number" name="reminderDays" min={1} max={365} defaultValue={data.reminderDays} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="autoRenew" value="yes" defaultChecked={data.autoRenew} />
            Renew on its own
          </label>
          <Field label="Included work">
            <textarea className={inputClass} name="scope" rows={4} defaultValue={data.scope ?? ""} />
          </Field>
          <Field label="Notes">
            <textarea className={inputClass} name="notes" rows={2} defaultValue={data.notes ?? ""} />
          </Field>
          <button className={ghostClass} type="submit">
            Save terms
          </button>
        </form>
      </Panel>
      <Panel>
        <h2 className="mb-3 font-serif text-xl">Covered locations</h2>
        <form action={saveCoveredPropertiesAction} className="space-y-2">
          <input type="hidden" name="id" value={id} />
          {data.customerProperties.map((property) => (
            <label key={property.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="propertyIds" value={property.id} defaultChecked={covered.has(property.id)} />
              {property.label} · {property.city}
            </label>
          ))}
          <button className={ghostClass} type="submit">
            Save locations
          </button>
        </form>
      </Panel>
      <Panel className="space-y-3">
        <h2 className="font-serif text-xl">Equipment</h2>
        <ul className="space-y-2 text-sm">
          {data.equipment.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-2">
              <span>
                {item.name}
                {item.location ? ` · ${item.location}` : ""}
                {item.serial ? ` · ${item.serial}` : ""}
              </span>
              <form action={removeEquipmentAction}>
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="equipmentId" value={item.id} />
                <button className="text-sm text-danger" type="submit">
                  Remove
                </button>
              </form>
            </li>
          ))}
        </ul>
        {data.equipment.length === 0 ? <p className="text-sm text-muted">No equipment listed.</p> : null}
        <form action={addEquipmentAction} className="grid gap-3 md:grid-cols-2">
          <input type="hidden" name="id" value={id} />
          <Field label="Name">
            <input className={inputClass} name="name" required />
          </Field>
          <Field label="Location">
            <select className={inputClass} name="propertyId" defaultValue={data.propertyId}>
              {data.coveredProperties.map((property) => (
                <option key={property.id} value={property.id}>
                  {property.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Where it is">
            <input className={inputClass} name="location" />
          </Field>
          <Field label="Serial">
            <input className={inputClass} name="serial" />
          </Field>
          <button className={ghostClass} type="submit">
            Add equipment
          </button>
        </form>
      </Panel>
      <section className="space-y-4">
        <h2 className="font-serif text-2xl">Visit schedules</h2>
        {data.schedules.map((schedule) => (
          <Panel key={schedule.id} className="space-y-3">
            <form action={updateScheduleAction} className="space-y-3">
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="scheduleId" value={schedule.id} />
              <Field label="Visit name">
                <input className={inputClass} name="title" required defaultValue={schedule.title} />
              </Field>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="How often">
                  <select className={inputClass} name="frequency" defaultValue={schedule.frequency}>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="annual">Annual</option>
                    <option value="custom">Custom</option>
                  </select>
                </Field>
                <Field label="Technician">
                  <select className={inputClass} name="technicianId" defaultValue={schedule.technicianId ?? ""}>
                    <option value="">Unassigned</option>
                    {techs.map((tech) => (
                      <option key={tech.id} value={tech.id}>
                        {tech.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Anchor date">
                  <input className={inputClass} type="date" name="anchorOn" required defaultValue={schedule.anchorOn} />
                </Field>
                <Field label="Start time">
                  <input className={inputClass} type="time" name="localStart" required defaultValue={schedule.localStart} />
                </Field>
                <Field label="Minutes">
                  <input className={inputClass} type="number" name="durationMinutes" min={15} max={480} defaultValue={schedule.durationMinutes} />
                </Field>
                <Field label="Horizon days">
                  <input className={inputClass} type="number" name="horizonDays" min={7} max={366} defaultValue={schedule.horizonDays} />
                </Field>
                <Field label="Custom every">
                  <input className={inputClass} type="number" name="intervalCount" min={1} max={52} defaultValue={schedule.intervalCount} />
                </Field>
                <Field label="Custom unit">
                  <select className={inputClass} name="intervalUnit" defaultValue={schedule.intervalUnit}>
                    <option value="day">Days</option>
                    <option value="week">Weeks</option>
                    <option value="month">Months</option>
                  </select>
                </Field>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="active" value="yes" defaultChecked={schedule.active} />
                Active
              </label>
              <Field label="Instructions">
                <textarea className={inputClass} name="instructions" rows={2} defaultValue={schedule.instructions ?? ""} />
              </Field>
              <button className={ghostClass} type="submit">
                Save schedule
              </button>
            </form>
            <ul className="space-y-2 text-sm">
              {schedule.occurrences.map((occurrence) => (
                <li key={occurrence.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line px-3 py-2">
                  <div>
                    <TextLink href={occurrence.visitId ? `/schedule?day=${occurrence.occursOn}` : `/contracts/${id}`}>
                      {occurrence.occursOn}
                      {occurrence.scheduledStart ? ` · ${when(occurrence.scheduledStart)}` : ""}
                    </TextLink>
                    <p className="text-muted">
                      {occurrence.technicianName ?? "Unassigned"}
                      {occurrence.occursOn !== occurrence.originalOn ? ` · moved off ${occurrence.originalOn}` : ""}
                      {occurrence.skipReason ? ` · ${occurrence.skipReason}` : ""}
                      {occurrence.pinned ? " · edited by hand" : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusPill status={occurrence.visitStatus ?? occurrence.status} />
                    {occurrence.status !== "skipped" && occurrence.visitStatus === "scheduled" ? (
                      <form action={skipOccurrenceAction}>
                        <input type="hidden" name="id" value={id} />
                        <input type="hidden" name="occurrenceId" value={occurrence.id} />
                        <button className={ghostClass} type="submit">
                          Skip
                        </button>
                      </form>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
            {schedule.occurrences.length === 0 ? <p className="text-sm text-muted">No visits in the horizon yet.</p> : null}
          </Panel>
        ))}
        <Panel>
          <h3 className="mb-3 font-serif text-xl">Add a schedule</h3>
          <form action={createScheduleAction} className="grid gap-3 md:grid-cols-2">
            <input type="hidden" name="id" value={id} />
            <Field label="Visit name">
              <input className={inputClass} name="title" required />
            </Field>
            <Field label="How often">
              <select className={inputClass} name="frequency" defaultValue="monthly">
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annual">Annual</option>
                <option value="custom">Custom</option>
              </select>
            </Field>
            <Field label="First visit">
              <input className={inputClass} type="date" name="anchorOn" required defaultValue={data.startsOn} />
            </Field>
            <Field label="Start time">
              <input className={inputClass} type="time" name="localStart" defaultValue="09:00" />
            </Field>
            <Field label="Minutes">
              <input className={inputClass} type="number" name="durationMinutes" min={15} max={480} defaultValue={60} />
            </Field>
            <Field label="Horizon days">
              <input className={inputClass} type="number" name="horizonDays" min={7} max={366} defaultValue={90} />
            </Field>
            <Field label="Custom every">
              <input className={inputClass} type="number" name="intervalCount" min={1} max={52} defaultValue={1} />
            </Field>
            <Field label="Custom unit">
              <select className={inputClass} name="intervalUnit" defaultValue="month">
                <option value="day">Days</option>
                <option value="week">Weeks</option>
                <option value="month">Months</option>
              </select>
            </Field>
            <Field label="Technician">
              <select className={inputClass} name="technicianId" defaultValue="">
                <option value="">Unassigned</option>
                {techs.map((tech) => (
                  <option key={tech.id} value={tech.id}>
                    {tech.name}
                  </option>
                ))}
              </select>
            </Field>
            <button className={buttonClass} type="submit">
              Add schedule
            </button>
          </form>
        </Panel>
      </section>
      <Panel>
        <h2 className="mb-3 font-serif text-xl">Invoices</h2>
        {data.charges.length === 0 ? <p className="text-sm text-muted">Nothing billed yet.</p> : null}
        <ul className="space-y-2 text-sm">
          {data.charges.map((charge) => (
            <li key={charge.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {charge.invoiceId && charge.invoiceNumber ? (
                  <TextLink href={`/invoices/${charge.invoiceId}`}>{invoiceNo(charge.invoiceNumber)}</TextLink>
                ) : (
                  "Invoice"
                )}{" "}
                {charge.periodStart} to {charge.periodEnd} · {money(charge.amountCents)}
              </span>
              <span className="text-muted">
                {charge.stripeInvoiceId
                  ? `Stripe test ${charge.stripeInvoiceId}`
                  : charge.stripeError
                    ? charge.stripeError
                    : "In this company's books. Not sent to Stripe."}
              </span>
            </li>
          ))}
        </ul>
      </Panel>
      {data.renewals.length ? (
        <Panel>
          <h2 className="mb-3 font-serif text-xl">Renewal history</h2>
          <ul className="space-y-1 text-sm">
            {data.renewals.map((renewal) => (
              <li key={renewal.id}>
                {renewal.source === "auto" ? "Auto-renewed" : "Renewed"} through {renewal.newEndsOn} at {money(renewal.newPriceCents)}
                {renewal.previousPriceCents !== renewal.newPriceCents ? ` (was ${money(renewal.previousPriceCents)})` : ""}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      {data.status === "active" || data.status === "draft" || data.status === "lapsed" ? (
        <form action={cancelContractAction}>
          <input type="hidden" name="id" value={id} />
          <button className={dangerClass} type="submit">
            Cancel contract
          </button>
        </form>
      ) : null}
    </div>
  );
}
