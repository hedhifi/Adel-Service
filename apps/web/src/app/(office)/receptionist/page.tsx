import { Empty, PageHeader, StatusPill, TextLink } from "@/components/ui";
import { when } from "@/lib/format";
import { listReceptionistConversations } from "@adel/core";
import { requireOffice } from "@/server/session";
import Link from "next/link";

export default async function ReceptionistLogPage() {
  const actor = await requireOffice();
  const entityName = actor.entities.find((entity) => entity.entityId === actor.entityId)?.name ?? "This company";
  const { data } = await listReceptionistConversations(actor);
  return (
    <div data-testid="receptionist-log">
      <PageHeader
        title="Conversation log"
        lede={`Phone and website chats for ${entityName}. Each row is this company only.`}
        action={
          <Link className="text-sm font-semibold text-pine" href="/receptionist/settings">
            Receptionist settings
          </Link>
        }
      />
      {data.length === 0 ? <Empty>No receptionist conversations for this company yet.</Empty> : null}
      <ul className="divide-y divide-line rounded-lg border border-line bg-card">
        {data.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
            <div>
              <TextLink href={`/receptionist/${row.id}`}>{row.callerName || "New conversation"}</TextLink>
              <p className="text-muted">
                {entityName} · {row.channel === "phone" ? "Phone" : "Website"} · {row.language === "es" ? "Spanish" : "English"} · {when(row.createdAt)}
              </p>
            </div>
            <StatusPill status={row.outcome} />
            {row.requestId ? <TextLink href={`/requests/${row.requestId}`}>{row.requestTitle || "Request"}</TextLink> : <span className="text-muted">No request</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
