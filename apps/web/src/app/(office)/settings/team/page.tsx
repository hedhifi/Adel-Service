import { Field, Flash, PageHeader, StatusPill, buttonClass, ghostClass, inputClass } from "@/components/ui";
import { createUserAction, setUserActiveAction } from "@/server/actions";
import { requireAdmin } from "@/server/session";
import { listUsers } from "@adel/core";

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const actor = await requireAdmin();
  const query = await searchParams;
  const { data } = await listUsers(actor);
  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title="People" lede="Admin, office, and technician are the only roles." />
      <Flash error={query.error} notice={query.notice} />
      <ul className="divide-y divide-line rounded-lg border border-line bg-card">
        {data.map((person) => (
          <li key={person.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
            <div>
              <p className="font-semibold">{person.name}</p>
              <p className="text-muted">{person.email}</p>
            </div>
            <StatusPill status={person.role} />
            {person.active ? null : <StatusPill status="canceled" />}
            {person.id !== actor.id ? (
              <form action={setUserActiveAction}>
                <input type="hidden" name="id" value={person.id} />
                <input type="hidden" name="active" value={person.active ? "false" : "true"} />
                <button className={ghostClass} type="submit">
                  {person.active ? "Deactivate" : "Reactivate"}
                </button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
      <form action={createUserAction} className="space-y-3 rounded-lg border border-line bg-card p-4">
        <h2 className="font-serif text-xl">Add someone</h2>
        <Field label="Name">
          <input className={inputClass} name="name" required />
        </Field>
        <Field label="Email">
          <input className={inputClass} name="email" type="email" required />
        </Field>
        <Field label="Temporary password">
          <input className={inputClass} name="password" type="text" minLength={10} required />
        </Field>
        <Field label="Role">
          <select className={inputClass} name="role" defaultValue="tech">
            <option value="admin">Admin</option>
            <option value="office">Office</option>
            <option value="tech">Technician</option>
          </select>
        </Field>
        <button className={buttonClass} type="submit">
          Add
        </button>
      </form>
    </div>
  );
}
