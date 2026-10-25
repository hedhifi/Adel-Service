import { Flash, PageHeader, Panel, StatusPill, buttonClass, ghostClass } from "@/components/ui";
import { when } from "@/lib/format";
import { getQuickBooks, listQuickBooksConflicts, listQuickBooksLog, quickBooksPluginEnabled } from "@adel/core";
import { connectQuickBooksAction, disconnectQuickBooksAction, resolveConflictAction, retryQuickBooksAction, syncQuickBooksAction } from "@/server/books-actions";
import { requireOffice } from "@/server/session";
import Link from "next/link";
import { notFound } from "next/navigation";

export default async function QuickBooksPluginPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  if (!quickBooksPluginEnabled()) notFound();
  const actor = await requireOffice();
  const query = await searchParams;
  const [{ data }, conflicts, log] = await Promise.all([
    getQuickBooks(actor),
    listQuickBooksConflicts(actor),
    listQuickBooksLog(actor),
  ]);
  const connection = data.connection;
  return (
    <div className="space-y-6">
      <PageHeader
        title="QuickBooks plug-in"
        lede="Optional, and sandbox only. This company would sync to its own QuickBooks file. The other company would not share it. The books in Adel Service stay the record either way."
        action={
          <Link className={ghostClass} href="/books">
            Books
          </Link>
        }
      />
      <Flash error={query.error} notice={query.notice} />
      <Panel>
        {connection ? (
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="font-semibold">{connection.companyName}</p>
              <p className="text-sm text-muted">
                {connection.provider === "mock" ? "Mock sandbox" : "Intuit sandbox"} · realm {connection.realmId}
              </p>
              <p className="text-sm text-muted">Connected {when(connection.connectedAt)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <form action={syncQuickBooksAction}>
                <button className={buttonClass} type="submit">
                  Sync now
                </button>
              </form>
              <form action={retryQuickBooksAction}>
                <button className={ghostClass} type="submit">
                  Retry failed ({data.failed})
                </button>
              </form>
              <form action={disconnectQuickBooksAction}>
                <button className={ghostClass} type="submit">
                  Disconnect
                </button>
              </form>
            </div>
          </div>
        ) : (
          <form action={connectQuickBooksAction} className="space-y-3">
            <p className="text-sm">No QuickBooks company is connected for this book. Connecting does not touch a live QuickBooks file.</p>
            <button className={buttonClass} type="submit">
              Connect QuickBooks sandbox
            </button>
          </form>
        )}
      </Panel>
      <Panel>
        <h2 className="mb-3 font-serif text-xl">Conflicts ({conflicts.data.length})</h2>
        {conflicts.data.length === 0 ? <p className="text-sm text-muted">Nothing changed in both places.</p> : null}
        <ul className="space-y-3">
          {conflicts.data.map((row) => (
            <li key={`${row.resourceType}-${row.resourceId}`} className="rounded-md border border-line px-3 py-3 text-sm">
              <p className="font-semibold">{row.label}</p>
              <p className="text-muted">{row.message}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <form action={resolveConflictAction}>
                  <input type="hidden" name="resourceType" value={row.resourceType} />
                  <input type="hidden" name="resourceId" value={row.resourceId} />
                  <input type="hidden" name="choice" value="local" />
                  <button className={buttonClass} type="submit">
                    Keep our version
                  </button>
                </form>
                {row.resourceType === "customer" || row.resourceType === "item" || row.resourceType === "vendor" ? (
                  <form action={resolveConflictAction}>
                    <input type="hidden" name="resourceType" value={row.resourceType} />
                    <input type="hidden" name="resourceId" value={row.resourceId} />
                    <input type="hidden" name="choice" value="remote" />
                    <button className={ghostClass} type="submit">
                      Keep QuickBooks
                    </button>
                  </form>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel>
        <h2 className="mb-3 font-serif text-xl">Sync log</h2>
        {log.data.length === 0 ? <p className="text-sm text-muted">No syncs yet.</p> : null}
        <ul className="divide-y divide-line">
          {log.data.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span>{row.message}</span>
              <span className="text-muted">{when(row.createdAt)}</span>
              <StatusPill status={row.status} />
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
