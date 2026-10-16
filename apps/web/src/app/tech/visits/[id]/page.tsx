import { CardPayment } from "@/components/card-payment";
import { DictatedText } from "@/components/dictated-text";
import { SignaturePad } from "@/components/signature-pad";
import { VoiceField } from "@/components/voice-field";
import { Flash, StatusPill, buttonClass, ghostClass, inputClass } from "@/components/ui";
import { address, money, when } from "@/lib/format";
import {
  addFormAction,
  clockAction,
  noteAction,
  photoAction,
  saveFormAction,
  signatureAction,
  suggestTermAction,
  visitStatusAction,
} from "@/server/actions";
import { requireUser } from "@/server/session";
import { AppError, activeSpeechPhrases, getCompanySettings, getDictationLanguage, getVisit, listFormTemplates, stripePublishableKey } from "@adel/core";

export default async function VisitPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const actor = await requireUser();
  const { id } = await params;
  const query = await searchParams;
  const [{ data }, settings, forms, phrases, dictationLanguage] = await Promise.all([
    getVisit(actor, id),
    getCompanySettings(),
    listFormTemplates(actor),
    activeSpeechPhrases(),
    getDictationLanguage(actor.id),
  ]);
  let publishable: string | null = null;
  try {
    publishable = stripePublishableKey();
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
  }
  const openClock = data.timeEntries.some((entry) => entry.userId === actor.id && !entry.endedAt);
  const maps = `https://maps.google.com/?q=${encodeURIComponent(address({ line1: data.line1, line2: data.line2, city: data.city, state: data.state, postalCode: data.postalCode }))}`;
  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-muted">{data.brandName}</p>
        <h1 className="font-serif text-3xl">{data.customerName}</h1>
        <p className="text-sm">{when(data.scheduledStart, settings.timeZone)}</p>
        <div className="mt-2">
          <StatusPill status={data.status} />
        </div>
      </div>
      <Flash error={query.error} notice={query.notice} />
      <p>
        <a className="font-semibold text-pine" href={maps}>
          {data.line1}, {data.city}
        </a>
      </p>
      {data.customerPhone ? (
        <p>
          <a className="font-semibold text-pine" href={`tel:${data.customerPhone}`}>
            {data.customerPhone}
          </a>
        </p>
      ) : null}
      {data.accessNotes ? <p className="rounded-md bg-[#efe7d6] px-3 py-2 text-sm">{data.accessNotes}</p> : null}
      {data.instructions ? <p className="whitespace-pre-wrap text-sm">{data.instructions}</p> : null}
      <div className="grid grid-cols-2 gap-2">
        {data.status === "scheduled" ? <StatusButton id={id} status="en_route" label="On the way" /> : null}
        {data.status === "scheduled" || data.status === "en_route" ? <StatusButton id={id} status="on_site" label="On site" /> : null}
        {data.status !== "completed" && data.status !== "canceled" ? <StatusButton id={id} status="completed" label="Complete" /> : null}
      </div>
      <section id="time" className="rounded-lg border border-line bg-card p-4">
        <h2 className="font-serif text-xl">Time</h2>
        <ul className="my-2 text-sm">
          {data.timeEntries.map((entry) => (
            <li key={entry.id}>
              {when(entry.startedAt, settings.timeZone)} – {entry.endedAt ? when(entry.endedAt, settings.timeZone) : "clocked in"}
              {entry.note ? (
                <div className="mt-1">
                  <DictatedText text={entry.note} raw={entry.rawNote} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        <form action={clockAction} className="space-y-2">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="action" value={openClock ? "out" : "in"} />
          <VoiceField name="note" rawName="rawNote" phrases={phrases} defaultLanguage={dictationLanguage} multiline rows={2} placeholder="What was the time for?" label="Time note" />
          <button className={buttonClass} type="submit">
            {openClock ? "Clock out" : "Clock in"}
          </button>
        </form>
      </section>
      <section id="notes" className="space-y-2">
        <h2 className="font-serif text-xl">Notes</h2>
        <ul className="space-y-2 text-sm">
          {data.notes.map((note) => (
            <li key={note.id} className="rounded-md border border-line bg-card px-3 py-2">
              <DictatedText text={note.body} raw={note.rawBody} sourceLanguage={note.sourceLanguage} />
              <p className="text-xs text-muted">
                {note.authorName} · {when(note.createdAt, settings.timeZone)}
              </p>
            </li>
          ))}
        </ul>
        <form action={noteAction} className="space-y-2">
          <input type="hidden" name="id" value={id} />
          <VoiceField name="body" rawName="rawBody" phrases={phrases} defaultLanguage={dictationLanguage} saveDefault multiline required placeholder="What did you find?" label="Note" />
          <button className={ghostClass} type="submit">
            Add note
          </button>
        </form>
      </section>
      <section id="photos" className="space-y-2">
        <h2 className="font-serif text-xl">Photos</h2>
        <div className="grid grid-cols-2 gap-2">
          {data.photos.map((photo) => (
            <figure key={photo.id}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="h-32 w-full rounded-md object-cover" src={`/api/v1/visits/${id}/photos/${photo.id}`} alt={photo.caption ?? "Visit photo"} />
              {photo.caption ? (
                <figcaption className="text-xs text-muted">
                  <DictatedText text={photo.caption} raw={photo.rawCaption} />
                </figcaption>
              ) : null}
            </figure>
          ))}
        </div>
        <form action={photoAction} className="space-y-2">
          <input type="hidden" name="id" value={id} />
          <input className={inputClass} name="file" type="file" accept="image/jpeg,image/png,image/webp" required />
          <VoiceField name="caption" rawName="rawCaption" phrases={phrases} defaultLanguage={dictationLanguage} languageName="captionLanguage" placeholder="Caption" label="Caption" />
          <button className={ghostClass} type="submit">
            Upload photo
          </button>
        </form>
      </section>
      <section id="forms" className="space-y-3">
        <h2 className="font-serif text-xl">Forms</h2>
        {data.forms.map((form) => (
          <form key={form.id} action={saveFormAction} className="space-y-2 rounded-lg border border-line bg-card p-3">
            <h3 className="font-semibold">{form.name}</h3>
            <input type="hidden" name="visitId" value={id} />
            <input type="hidden" name="formId" value={form.id} />
            {form.items.map((item) => {
              const response = form.responses.find((entry) => entry.itemId === item.id);
              return (
                <div key={item.id} className="block text-sm">
                  <input type="hidden" name="itemId" value={item.id} />
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="item" value={item.id} defaultChecked={response?.checked} />
                    {item.label}
                    {item.required ? " *" : ""}
                  </label>
                  <div className="mt-1">
                    <VoiceField
                      name={`note__${item.id}`}
                      rawName={`raw__${item.id}`}
                      phrases={phrases}
                      defaultLanguage={dictationLanguage}
                      languageName={`lang__${item.id}`}
                      placeholder="Note"
                      defaultValue={response?.note ?? ""}
                      defaultRaw={response?.rawNote ?? ""}
                      label="Checklist note"
                    />
                  </div>
                </div>
              );
            })}
            <button className={ghostClass} type="submit">
              Save form
            </button>
          </form>
        ))}
        <form action={addFormAction} className="flex gap-2">
          <input type="hidden" name="id" value={id} />
          <select className={inputClass} name="templateId" required>
            {forms.data.map((form) => (
              <option key={form.id} value={form.id}>
                {form.name}
              </option>
            ))}
          </select>
          <button className={ghostClass} type="submit">
            Add
          </button>
        </form>
      </section>
      <section className="space-y-2">
        <h2 className="font-serif text-xl">Signature</h2>
        {data.hasSignature ? (
          <div>
            <div className="text-sm">
              Signed by <DictatedText text={data.signedByName ?? ""} raw={data.signedByRaw} />
            </div>
            {data.signaturePng ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={data.signaturePng} alt={`Signature of ${data.signedByName}`} className="mt-2 h-24 rounded-md border border-line bg-white" />
            ) : null}
          </div>
        ) : null}
        {data.status !== "completed" && data.status !== "canceled" ? (
          <form action={signatureAction}>
            <input type="hidden" name="id" value={id} />
            <SignaturePad phrases={phrases} defaultLanguage={dictationLanguage} />
          </form>
        ) : null}
      </section>
      <section className="space-y-2">
        <h2 className="font-serif text-xl">Suggest a spelling</h2>
        <p className="text-xs text-muted">Office reviews it before dictation starts using it.</p>
        <form action={suggestTermAction} className="flex gap-2">
          <input type="hidden" name="visitId" value={id} />
          <input className={inputClass} name="phrase" required maxLength={80} placeholder="Brand or part name" />
          <button className={ghostClass} type="submit">
            Suggest
          </button>
        </form>
      </section>
      {data.invoice && (data.invoice.status === "issued" || data.invoice.status === "partial") && data.invoice.balanceCents > 0 ? (
        <section className="rounded-lg border border-line bg-card p-4">
          <h2 className="mb-2 font-serif text-xl">Collect {money(data.invoice.balanceCents)}</h2>
          <CardPayment invoiceId={data.invoice.id} publishableKey={publishable} balanceLabel={money(data.invoice.balanceCents)} />
        </section>
      ) : null}
    </div>
  );
}

function StatusButton({ id, status, label }: { id: string; status: string; label: string }) {
  return (
    <form action={visitStatusAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <button className={`${status === "completed" ? buttonClass : ghostClass} w-full`} type="submit">
        {label}
      </button>
    </form>
  );
}
