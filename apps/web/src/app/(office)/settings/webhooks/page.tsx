import { Field, Flash, PageHeader, buttonClass, ghostClass, inputClass } from "@/components/ui";
import { createWebhookAction, disableWebhookAction } from "@/server/actions";
import { requireOffice } from "@/server/session";
import { WEBHOOK_EVENTS, listWebhookEndpoints } from "@adel/core";

export default async function WebhooksPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string; secret?: string }>;
}) {
  const actor = await requireOffice();
  const query = await searchParams;
  const { data } = await listWebhookEndpoints(actor);
  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        title="Webhooks"
        lede="We POST JSON when work moves. Verify X-Adel-Signature over the raw body as hex HMAC-SHA256 of timestamp + '.' + body, using the signing secret."
      />
      <Flash error={query.error} notice={query.notice} />
      {query.secret ? <p className="break-all rounded-md bg-ok-bg px-3 py-2 font-mono text-sm">{query.secret}</p> : null}
      <ul className="space-y-2 text-sm">
        {data.map((hook) => (
          <li key={hook.id} className="rounded-lg border border-line bg-card px-4 py-3">
            <p className="font-semibold">{hook.url}</p>
            <p className="text-muted">{hook.events.join(", ")} {hook.active ? "" : "· off"}</p>
            {hook.active ? (
              <form action={disableWebhookAction} className="mt-2">
                <input type="hidden" name="id" value={hook.id} />
                <button className={ghostClass} type="submit">
                  Turn off
                </button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
      <form action={createWebhookAction} className="space-y-3 rounded-lg border border-line bg-card p-4">
        <Field label="URL">
          <input className={inputClass} name="url" type="url" required placeholder="https://example.com/adel" />
        </Field>
        <Field label="Description">
          <input className={inputClass} name="description" />
        </Field>
        <fieldset className="space-y-1 text-sm">
          <legend className="font-semibold">Events</legend>
          {WEBHOOK_EVENTS.map((event) => (
            <label key={event} className="flex items-center gap-2">
              <input type="checkbox" name="events" value={event} />
              {event}
            </label>
          ))}
        </fieldset>
        <button className={buttonClass} type="submit">
          Add endpoint
        </button>
      </form>
    </div>
  );
}
