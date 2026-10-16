import { Field, Flash, PageHeader, buttonClass, ghostClass, inputClass } from "@/components/ui";
import { createTokenAction, revokeTokenAction } from "@/server/actions";
import { requireAdmin } from "@/server/session";
import { listApiTokens, listUsers } from "@adel/core";

export default async function TokensPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string; secret?: string }>;
}) {
  const actor = await requireAdmin();
  const query = await searchParams;
  const [{ data }, people] = await Promise.all([listApiTokens(actor), listUsers(actor)]);
  const techs = people.data.filter((person) => person.role === "tech" && person.active);
  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title="API tokens" lede="Tokens carry a role. A technician token is tied to that person. Copy a new token now — it is not shown again." />
      <Flash error={query.error} notice={query.notice} />
      {query.secret ? (
        <p className="break-all rounded-md bg-ok-bg px-3 py-2 font-mono text-sm">
          {query.secret}
        </p>
      ) : null}
      <ul className="divide-y divide-line rounded-lg border border-line bg-card text-sm">
        {data.map((token) => (
          <li key={token.id} className="flex items-center justify-between gap-2 px-4 py-3">
            <div>
              <p className="font-semibold">{token.name}</p>
              <p className="text-muted">
                {token.tokenPrefix}… · {token.role}
                {token.revokedAt ? " · revoked" : ""}
              </p>
            </div>
            {token.revokedAt ? null : (
              <form action={revokeTokenAction}>
                <input type="hidden" name="id" value={token.id} />
                <button className={ghostClass} type="submit">
                  Revoke
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>
      <form action={createTokenAction} className="space-y-3 rounded-lg border border-line bg-card p-4">
        <Field label="Name">
          <input className={inputClass} name="name" required placeholder="Dispatch laptop" />
        </Field>
        <Field label="Role">
          <select className={inputClass} name="role" defaultValue="office">
            <option value="admin">Admin</option>
            <option value="office">Office</option>
            <option value="tech">Technician</option>
          </select>
        </Field>
        <Field label="Technician (required for a tech token)">
          <select className={inputClass} name="userId" defaultValue="">
            <option value="">—</option>
            {techs.map((tech) => (
              <option key={tech.id} value={tech.id}>
                {tech.name}
              </option>
            ))}
          </select>
        </Field>
        <button className={buttonClass} type="submit">
          Create token
        </button>
      </form>
    </div>
  );
}
