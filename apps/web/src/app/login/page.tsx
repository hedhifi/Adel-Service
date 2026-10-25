import { Flash, Field, buttonClass, inputClass } from "@/components/ui";
import { loginAction } from "@/server/actions";
import { getActor } from "@/server/session";
import { redirect } from "next/navigation";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const actor = await getActor();
  if (actor?.role === "tech") redirect("/tech");
  if (actor) redirect("/");
  const query = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
      <p className="text-sm font-semibold uppercase tracking-wide text-copper">Adel Electric</p>
      <h1 className="mt-2 font-serif text-4xl">Adel Service</h1>
      <p className="mt-2 text-sm text-muted">Office dispatch and the field app for Adel Electric crews.</p>
      <form action={loginAction} className="mt-6 space-y-3 rounded-lg border border-line bg-card p-4">
        <Flash error={query.error} />
        <input type="hidden" name="next" value={query.next ?? ""} />
        <Field label="Email">
          <input className={inputClass} name="email" type="email" autoComplete="username" required />
        </Field>
        <Field label="Password">
          <input className={inputClass} name="password" type="password" autoComplete="current-password" required />
        </Field>
        <button className={`${buttonClass} w-full`} type="submit">
          Sign in
        </button>
      </form>
      {process.env.NODE_ENV !== "production" ? (
        <div className="mt-4 rounded-lg border border-line bg-card p-4 text-sm text-muted">
          <p className="font-semibold text-ink">Demo logins</p>
          <p className="mt-1">Password for each: Fieldnote-demo-2026</p>
          <ul className="mt-2 space-y-1">
            <li>alan@adel.example — admin</li>
            <li>renee.okonkwo@adel.example — office</li>
            <li>marco.vell@adel.example — technician</li>
            <li>sofia.brennan@adel.example — technician</li>
          </ul>
        </div>
      ) : null}
    </main>
  );
}
