import { BrandChip, Field, Flash, PageHeader, StatusPill, TextLink, buttonClass, inputClass } from "@/components/ui";
import { address } from "@/lib/format";
import { createPropertyAction } from "@/server/actions";
import { requireOffice } from "@/server/session";
import { getCustomer, listInvoices, listJobs, listQuotes, listRequests } from "@adel/core";

export default async function CustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const actor = await requireOffice();
  const { id } = await params;
  const query = await searchParams;
  const { data } = await getCustomer(actor, id);
  const [requestPage, quotePage, jobPage, invoicePage] = await Promise.all([
    listRequests(actor, { customerId: id, limit: 20 }),
    listQuotes(actor, { customerId: id, limit: 20 }),
    listJobs(actor, { customerId: id, limit: 20 }),
    listInvoices(actor, { customerId: id, limit: 20 }),
  ]);
  const mine = {
    requests: requestPage.data,
    quotes: quotePage.data,
    jobs: jobPage.data,
    invoices: invoicePage.data,
  };
  return (
    <div className="space-y-6">
      <PageHeader title={data.name} lede={[data.phone, data.email].filter(Boolean).join(" · ")} action={<BrandChip name={data.brandName} />} />
      <Flash error={query.error} />
      {data.notes ? <p className="max-w-2xl text-sm">{data.notes}</p> : null}
      <section>
        <h2 className="mb-2 font-serif text-2xl">Service locations</h2>
        <ul className="space-y-2">
          {data.properties.map((property) => (
            <li key={property.id} className="rounded-lg border border-line bg-card px-4 py-3 text-sm">
              <p className="font-semibold">{property.label}</p>
              <p>{address(property)}</p>
              {property.accessNotes ? <p className="mt-1 text-muted">{property.accessNotes}</p> : null}
            </li>
          ))}
        </ul>
        <form action={createPropertyAction} className="mt-4 grid gap-3 rounded-lg border border-line bg-card p-4 md:grid-cols-2">
          <input type="hidden" name="customerId" value={id} />
          <Field label="Label">
            <input className={inputClass} name="label" required />
          </Field>
          <Field label="Street">
            <input className={inputClass} name="line1" required />
          </Field>
          <Field label="City">
            <input className={inputClass} name="city" required />
          </Field>
          <Field label="ZIP">
            <input className={inputClass} name="postalCode" required />
          </Field>
          <Field label="Access notes">
            <input className={inputClass} name="accessNotes" />
          </Field>
          <div className="flex items-end">
            <button className={buttonClass} type="submit">
              Add location
            </button>
          </div>
        </form>
      </section>
      <section className="grid gap-4 md:grid-cols-2">
        <Related title="Requests" rows={mine.requests.map((row) => ({ href: `/requests/${row.id}`, label: row.title, status: row.status }))} />
        <Related title="Estimates" rows={mine.quotes.map((row) => ({ href: `/quotes/${row.id}`, label: row.title, status: row.status }))} />
        <Related title="Jobs" rows={mine.jobs.map((row) => ({ href: `/jobs/${row.id}`, label: row.title, status: row.status }))} />
        <Related title="Invoices" rows={mine.invoices.map((row) => ({ href: `/invoices/${row.id}`, label: `INV-${row.number}`, status: row.status }))} />
      </section>
    </div>
  );
}

function Related({ title, rows }: { title: string; rows: Array<{ href: string; label: string; status: string }> }) {
  return (
    <div>
      <h2 className="mb-2 font-serif text-xl">{title}</h2>
      <ul className="space-y-1 text-sm">
        {rows.length === 0 ? <li className="text-muted">None yet.</li> : null}
        {rows.map((row) => (
          <li key={row.href} className="flex items-center justify-between gap-2">
            <TextLink href={row.href}>{row.label}</TextLink>
            <StatusPill status={row.status} />
          </li>
        ))}
      </ul>
    </div>
  );
}
