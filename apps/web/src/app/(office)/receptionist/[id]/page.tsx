import { PageHeader, StatusPill, TextLink } from "@/components/ui";
import { when } from "@/lib/format";
import { AppError, getReceptionistConversation } from "@adel/core";
import { requireOffice } from "@/server/session";
import Link from "next/link";
import { notFound } from "next/navigation";

export default async function ReceptionistConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireOffice();
  const { id } = await params;
  let result: Awaited<ReturnType<typeof getReceptionistConversation>>;
  try {
    result = await getReceptionistConversation(actor, id);
  } catch (err) {
    if (err instanceof AppError && err.status === 404) notFound();
    throw err;
  }
  const { conversation, messages, sandbox } = result.data;
  return (
    <div className="space-y-6" data-testid="receptionist-transcript">
      <PageHeader
        title={conversation.callerName || "Conversation"}
        lede={`${conversation.entityName} · ${conversation.channel === "phone" ? "Phone" : "Website"} · ${conversation.language === "es" ? "Spanish" : "English"}`}
        action={<StatusPill status={conversation.outcome} />}
      />
      <p className="text-sm">
        <Link className="font-semibold text-pine" href="/receptionist">
          Conversation log
        </Link>
        {conversation.requestId ? (
          <>
            {" · "}
            <TextLink href={`/requests/${conversation.requestId}`}>Open request</TextLink>
          </>
        ) : null}
      </p>
      <ol className="space-y-3">
        {messages.map((message) => (
          <li key={message.id} className="rounded-lg border border-line bg-card px-4 py-3 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              {message.role === "caller" ? "Caller" : "Receptionist"} · {when(message.createdAt)}
            </p>
            <p className="mt-1 whitespace-pre-wrap">{message.body}</p>
            {message.bodyEn !== message.body ? <p className="mt-2 whitespace-pre-wrap text-muted">English: {message.bodyEn}</p> : null}
          </li>
        ))}
      </ol>
      <section className="rounded-lg border border-line bg-card p-4">
        <h2 className="font-serif text-xl">Recorded, not sent</h2>
        <p className="mt-1 text-sm text-muted">Sandbox only. No live SMS or call left this app.</p>
        {sandbox.length === 0 ? <p className="mt-3 text-sm text-muted">Nothing was queued.</p> : null}
        <ul className="mt-3 space-y-3">
          {sandbox.map((message) => (
            <li key={message.id} className="text-sm">
              <p className="font-semibold">
                {message.kind.replaceAll("_", " ")} · {message.channel} · {message.provider}
                {message.delivered ? "" : " · not sent"}
                {message.toPhone ? ` · ${message.toPhone}` : ""}
              </p>
              <p className="mt-1 whitespace-pre-wrap">{message.body}</p>
              {message.bodyEn !== message.body ? <p className="mt-1 whitespace-pre-wrap text-muted">English: {message.bodyEn}</p> : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
