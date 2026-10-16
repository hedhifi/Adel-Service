import { Field, Flash, PageHeader, buttonClass, ghostClass, inputClass } from "@/components/ui";
import { createTermAction, deleteTermAction, updateTermAction } from "@/server/actions";
import { requireOffice } from "@/server/session";
import { listSpeechTerms } from "@adel/core";

export default async function TermsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const actor = await requireOffice();
  const query = await searchParams;
  const { data } = await listSpeechTerms(actor);
  const suggested = data.filter((term) => term.status === "suggested");
  const active = data.filter((term) => term.status === "active");
  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        title="Speech dictionary"
        lede="These spellings are offered to the phone’s speech engine and corrected after dictation. Customer names are included automatically and are not listed here."
      />
      <Flash error={query.error} notice={query.notice} />
      {suggested.length ? (
        <section className="space-y-2">
          <h2 className="font-serif text-xl">Suggestions</h2>
          <ul className="divide-y divide-line rounded-lg border border-line bg-card text-sm">
            {suggested.map((term) => (
              <li key={term.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span className="font-semibold">{term.phrase}</span>
                <span className="flex gap-2">
                  <form action={updateTermAction}>
                    <input type="hidden" name="id" value={term.id} />
                    <input type="hidden" name="status" value="active" />
                    <button className={buttonClass} type="submit">
                      Accept
                    </button>
                  </form>
                  <form action={deleteTermAction}>
                    <input type="hidden" name="id" value={term.id} />
                    <button className={ghostClass} type="submit">
                      Dismiss
                    </button>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <form action={createTermAction} className="flex gap-2">
        <Field label="New term">
          <input className={inputClass} name="phrase" required maxLength={80} placeholder="Crestron" />
        </Field>
        <button className={`${buttonClass} self-end`} type="submit">
          Add
        </button>
      </form>
      <ul className="divide-y divide-line rounded-lg border border-line bg-card text-sm">
        {active.map((term) => (
          <li key={term.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <form action={updateTermAction} className="flex min-w-0 flex-1 gap-2">
              <input type="hidden" name="id" value={term.id} />
              <input type="hidden" name="status" value="active" />
              <input className={inputClass} name="phrase" defaultValue={term.phrase} required maxLength={80} />
              <button className={ghostClass} type="submit">
                Save
              </button>
            </form>
            <form action={deleteTermAction}>
              <input type="hidden" name="id" value={term.id} />
              <button className={ghostClass} type="submit">
                Remove
              </button>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}
