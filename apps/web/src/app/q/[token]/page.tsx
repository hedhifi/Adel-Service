import { Flash, buttonClass, ghostClass, inputClass } from "@/components/ui";
import { money, quoteNo } from "@/lib/format";
import { publicDecisionAction } from "@/server/actions";
import { getPublicQuote } from "@adel/core";

export default async function PublicQuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const query = await searchParams;
  const { data } = await getPublicQuote(token);
  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <p className="text-sm font-semibold uppercase tracking-wide text-copper">{data.brandName}</p>
      <h1 className="font-serif text-4xl">{data.company}</h1>
      <p className="text-sm text-muted">{data.shopAddress}</p>
      <h2 className="mt-6 font-serif text-2xl">
        {quoteNo(data.number)} {data.title}
      </h2>
      <p className="text-sm">
        For {data.customerName} · {data.line1}, {data.city}
      </p>
      <Flash error={query.error} />
      {data.notes ? <p className="mt-4 whitespace-pre-wrap text-sm">{data.notes}</p> : null}
      <table className="mt-4 w-full text-sm">
        <tbody>
          {data.lineItems.map((line) => (
            <tr key={line.id} className="border-b border-line">
              <td className="py-2">{line.description}</td>
              <td className="py-2 text-right">{money(line.amountCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-right">
        Tax {money(data.taxCents)} · <strong>{money(data.totalCents)}</strong>
      </p>
      {data.status === "approved" ? <p className="mt-4 text-ok">Approved{data.approvedByName ? ` by ${data.approvedByName}` : ""}.</p> : null}
      {data.status === "declined" ? <p className="mt-4 text-danger">This estimate was declined.</p> : null}
      {data.expired ? <p className="mt-4 text-danger">This estimate is past its valid date. Call the office for a fresh one.</p> : null}
      {data.status === "sent" && !data.expired ? (
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <form action={publicDecisionAction} className="space-y-2 rounded-lg border border-line bg-card p-4">
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="decision" value="approve" />
            <input className={inputClass} name="name" required placeholder="Your name" />
            <button className={buttonClass} type="submit">
              Approve
            </button>
          </form>
          <form action={publicDecisionAction} className="space-y-2 rounded-lg border border-line bg-card p-4">
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="decision" value="decline" />
            <input className={inputClass} name="name" required placeholder="Your name" />
            <input className={inputClass} name="reason" placeholder="Reason, optional" />
            <button className={ghostClass} type="submit">
              Decline
            </button>
          </form>
        </div>
      ) : null}
    </main>
  );
}
