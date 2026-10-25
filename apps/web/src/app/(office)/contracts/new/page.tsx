import { CustomerPicker } from "@/components/customer-picker";
import { Field, Flash, PageHeader, TextLink, buttonClass, inputClass } from "@/components/ui";
import { createContractAction } from "@/server/actions";
import { requireOffice } from "@/server/session";
import { getCustomer, listCustomers, listUsers } from "@adel/core";

export default async function NewContractPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const actor = await requireOffice();
  const query = await searchParams;
  const [listed, people] = await Promise.all([listCustomers(actor, { limit: 100 }), listUsers(actor)]);
  const detailed = await Promise.all(listed.data.map((row) => getCustomer(actor, row.id)));
  const customers = detailed
    .map((row) => ({
      id: row.data.id,
      name: row.data.name,
      brandId: row.data.brandId,
      properties: row.data.properties.map((property) => ({ id: property.id, label: property.label, city: property.city })),
    }))
    .filter((row) => row.properties.length > 0);
  const techs = people.data.filter((person) => person.role === "tech" && person.active);
  return (
    <div className="max-w-2xl">
      <PageHeader title="New service contract" lede="Price, billing rhythm, included work, and an optional visit schedule. This writes into the company selected in the sidebar." />
      <form action={createContractAction} className="space-y-4">
        <Flash error={query.error} />
        {customers.length === 0 ? (
          <p className="text-sm">
            This company has no service locations yet. <TextLink href="/customers/new">Add a customer</TextLink> first.
          </p>
        ) : (
          <CustomerPicker customers={customers} />
        )}
        <Field label="Title">
          <input className={inputClass} name="title" required placeholder="Annual maintenance" />
        </Field>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Starts">
            <input className={inputClass} type="date" name="startsOn" required />
          </Field>
          <Field label="Ends">
            <input className={inputClass} type="date" name="endsOn" required />
          </Field>
          <Field label="Price each bill">
            <input className={inputClass} name="price" inputMode="decimal" required placeholder="150.00" />
          </Field>
          <Field label="Billing">
            <select className={inputClass} name="billingFrequency" defaultValue="monthly">
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="annual">Annual</option>
              <option value="custom">Custom months</option>
            </select>
          </Field>
          <Field label="Months between bills (custom)">
            <input className={inputClass} name="billingIntervalCount" type="number" min={1} max={36} defaultValue={1} />
          </Field>
          <Field label="Renewal term (months)">
            <input className={inputClass} name="renewalTermMonths" type="number" min={1} max={60} defaultValue={12} />
          </Field>
          <Field label="Remind this many days before the end">
            <input className={inputClass} name="reminderDays" type="number" min={1} max={365} defaultValue={30} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="autoRenew" value="yes" />
          Renew on its own when the end date arrives, at the same price
        </label>
        <Field label="Included work">
          <textarea className={inputClass} name="scope" rows={4} placeholder="What the flat fee covers. Extra work is a separate job." />
        </Field>
        <Field label="Notes">
          <textarea className={inputClass} name="notes" rows={2} />
        </Field>
        <fieldset className="space-y-3 rounded-lg border border-line p-4">
          <legend className="px-1 text-sm font-semibold">Covered equipment (optional)</legend>
          <Field label="Name">
            <input className={inputClass} name="equipmentName" placeholder="Main panel" />
          </Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Where it is">
              <input className={inputClass} name="equipmentLocation" />
            </Field>
            <Field label="Serial">
              <input className={inputClass} name="equipmentSerial" />
            </Field>
          </div>
        </fieldset>
        <fieldset className="space-y-3 rounded-lg border border-line p-4">
          <legend className="px-1 text-sm font-semibold">Visit schedule (optional)</legend>
          <Field label="How often">
            <select className={inputClass} name="scheduleFrequency" defaultValue="">
              <option value="">No visits yet</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="annual">Annual</option>
              <option value="custom">Custom</option>
            </select>
          </Field>
          <Field label="Visit name">
            <input className={inputClass} name="scheduleTitle" placeholder="Maintenance visit" />
          </Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="First visit">
              <input className={inputClass} type="date" name="anchorOn" />
            </Field>
            <Field label="Start time">
              <input className={inputClass} type="time" name="localStart" defaultValue="09:00" />
            </Field>
            <Field label="Minutes on site">
              <input className={inputClass} type="number" name="durationMinutes" min={15} max={480} defaultValue={60} />
            </Field>
            <Field label="Days to keep on the board">
              <input className={inputClass} type="number" name="horizonDays" min={7} max={366} defaultValue={90} />
            </Field>
            <Field label="Custom every">
              <input className={inputClass} type="number" name="scheduleIntervalCount" min={1} max={52} defaultValue={1} />
            </Field>
            <Field label="Custom unit">
              <select className={inputClass} name="scheduleIntervalUnit" defaultValue="month">
                <option value="day">Days</option>
                <option value="week">Weeks</option>
                <option value="month">Months</option>
              </select>
            </Field>
          </div>
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
          <Field label="Instructions for the crew">
            <textarea className={inputClass} name="scheduleInstructions" rows={2} />
          </Field>
        </fieldset>
        <button className={buttonClass} type="submit" disabled={customers.length === 0}>
          Save contract
        </button>
      </form>
    </div>
  );
}
