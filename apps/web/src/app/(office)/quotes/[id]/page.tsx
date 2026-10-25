import { Flash, PageHeader, StatusPill, buttonClass, ghostClass, inputClass } from "@/components/ui";
import { money, quoteNo } from "@/lib/format";
import { approveQuoteAction, convertQuoteAction, declineQuoteAction, sendQuoteAction } from "@/server/actions";
import { requireOffice } from "@/server/session";
import { getQuote } from "@adel/core";

export default async function QuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const actor = await requireOffice();
  const { id } = await params;
  const query = await searchParams;
  const { data } = await getQuote(actor, id);
  const link = data.publicPath ? `${process.env.APP_URL ?? "http://localhost:3000"}${data.publicPath}` : null;
  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader title={`${quoteNo(data.number)} ${data.title}`} lede={`${data.customerName} · ${data.brandName}`} action={<StatusPill status={data.status} />} />
      <Flash error={query.error} notice={query.notice} />
      {data.notes ? <p className="whitespace-pre-wrap text-sm">{data.notes}</p> : null}
      <table className="w-full text-sm">
        <tbody>
          {data.lineItems.map((line) => (
            <tr key={line.id} className="border-b border-line">
              <td className="py-2">{line.description}</td>
              <td className="py-2 text-muted">
                {line.quantity} × {money(line.unitAmountCents)}
              </td>
              <td className="py-2 text-right">{money(line.amountCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-right text-sm">
        Subtotal {money(data.subtotalCents)} · Tax {money(data.taxCents)} · <strong>{money(data.totalCents)}</strong>
      </p>
      {link ? (
        <p className="rounded-md bg-card px-3 py-2 text-sm">
          Customer link: <a className="font-semibold text-pine" href={data.publicPath!}>{link}</a>
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2 no-print">
        {data.status === "draft" ? (
          <form action={sendQuoteAction}>
            <input type="hidden" name="id" value={id} />
            <button className={buttonClass} type="submit">
              Mark sent and make link
            </button>
          </form>
        ) : null}
        {data.status === "draft" || data.status === "sent" ? (
          <form action={approveQuoteAction} className="flex gap-2">
            <input type="hidden" name="id" value={id} />
            <input className={inputClass} name="approvedByName" placeholder="Approved by" required />
            <button className={ghostClass} type="submit">
              Approve
            </button>
          </form>
        ) : null}
        {data.status === "draft" || data.status === "sent" ? (
          <form action={declineQuoteAction} className="flex gap-2">
            <input type="hidden" name="id" value={id} />
            <input className={inputClass} name="reason" placeholder="Reason, optional" />
            <button className={ghostClass} type="submit">
              Decline
            </button>
          </form>
        ) : null}
        {data.status === "approved" ? (
          <form action={convertQuoteAction}>
            <input type="hidden" name="id" value={id} />
            <button className={buttonClass} type="submit">
              Open a job
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
