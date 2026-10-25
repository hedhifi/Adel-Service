import { BrandChip, Flash, PageHeader, StatusPill, buttonClass, ghostClass, inputClass } from "@/components/ui";
import { updateRequestAction } from "@/server/actions";
import { requireOffice } from "@/server/session";
import { getRequest } from "@adel/core";
import Link from "next/link";

export default async function RequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const actor = await requireOffice();
  const { id } = await params;
  const query = await searchParams;
  const { data } = await getRequest(actor, id);
  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader title={data.title} lede={`${data.customerName} · ${data.line1}, ${data.city}`} action={<BrandChip name={data.brandName} />} />
      <Flash error={query.error} />
      <p className="whitespace-pre-wrap text-sm">{data.description}</p>
      <p className="text-sm text-muted">Came in by {data.source.replaceAll("_", " ")}.</p>
      <StatusPill status={data.status} />
      <form action={updateRequestAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="id" value={id} />
        <select className={inputClass} name="status" defaultValue={data.status}>
          {["new", "reviewing", "quoted", "closed", "canceled"].map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
        <button className={ghostClass} type="submit">
          Update status
        </button>
      </form>
      <Link className={buttonClass} href={`/quotes/new?requestId=${id}`}>
        Build an estimate
      </Link>
      {data.quotes.length > 0 ? (
        <ul className="text-sm">
          {data.quotes.map((quote) => (
            <li key={quote.id}>
              <Link className="font-semibold text-pine" href={`/quotes/${quote.id}`}>
                Q-{quote.number} {quote.title}
              </Link>{" "}
              <StatusPill status={quote.status} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
