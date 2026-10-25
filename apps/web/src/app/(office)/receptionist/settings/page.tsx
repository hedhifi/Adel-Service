import { Field, Flash, PageHeader, buttonClass, inputClass } from "@/components/ui";
import { saveReceptionistSettingsAction } from "@/server/actions";
import { getEntity, getReceptionistSettings } from "@adel/core";
import { requireOffice } from "@/server/session";

const DAYS = [
  [1, "Mon"],
  [2, "Tue"],
  [3, "Wed"],
  [4, "Thu"],
  [5, "Fri"],
  [6, "Sat"],
  [0, "Sun"],
];

export default async function ReceptionistSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const actor = await requireOffice();
  const query = await searchParams;
  const entity = await getEntity(actor);
  const { data } = await getReceptionistSettings(actor);
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const snippet = `<iframe src="${appUrl}/embed/${entity.slug}" title="${entity.name} chat" style="width:380px;height:640px;border:0"></iframe>`;
  return (
    <div className="max-w-2xl space-y-6" data-testid="receptionist-settings">
      <PageHeader title="Receptionist settings" lede={`Greeting, hours, and the on-call person for ${data.entityName}. Service Contracts keeps its own settings.`} />
      <Flash error={query.error} notice={query.notice} />
      <form action={saveReceptionistSettingsAction} className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="enabled" defaultChecked={data.enabled} />
          Receptionist is on
        </label>
        <Field label="Greeting, English">
          <textarea className={inputClass} name="greetingEn" rows={3} defaultValue={data.greetingEn} required />
        </Field>
        <Field label="Greeting, Spanish">
          <textarea className={inputClass} name="greetingEs" rows={3} defaultValue={data.greetingEs} required />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Hours start">
            <input className={inputClass} name="hoursStart" defaultValue={data.hoursStart} required />
          </Field>
          <Field label="Hours end">
            <input className={inputClass} name="hoursEnd" defaultValue={data.hoursEnd} required />
          </Field>
        </div>
        <fieldset>
          <legend className="text-sm font-semibold">Days</legend>
          <div className="mt-2 flex flex-wrap gap-3 text-sm">
            {DAYS.map(([value, label]) => (
              <label key={value} className="flex items-center gap-1">
                <input type="checkbox" name="hoursDays" value={value} defaultChecked={data.hoursDays.includes(Number(value))} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="On-call person">
          <select className={inputClass} name="onCallUserId" defaultValue={data.onCallUserId ?? ""}>
            <option value="">No one</option>
            {data.staff.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
                {person.phone ? ` · ${person.phone}` : ""}
              </option>
            ))}
          </select>
        </Field>
        <button className={buttonClass} type="submit">
          Save
        </button>
      </form>
      <section className="rounded-lg border border-line bg-card p-4 text-sm">
        <h2 className="font-serif text-xl">Website chat</h2>
        <p className="mt-1 text-muted">Paste this on the {entity.name} site. It opens that company only.</p>
        <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-md bg-paper p-3 text-xs">{snippet}</pre>
      </section>
    </div>
  );
}
