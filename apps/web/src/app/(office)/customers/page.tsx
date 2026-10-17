import { BrandChip, Empty, PageHeader, TextLink, buttonClass, inputClass } from "@/components/ui";
import { listCustomers } from "@adel/core";
import { requireOffice } from "@/server/session";
import Link from "next/link";

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const actor = await requireOffice();
  const query = await searchParams;
  const { data, total } = await listCustomers(actor, { q: query.q });
  return (
    <div>
      <PageHeader
        title="Customers"
        lede={`${total} on file for this company.`}
        action={
          <Link className={buttonClass} href="/customers/new">
            New customer
          </Link>
        }
      />
      <form className="mb-4 flex gap-2">
        <input className={inputClass} name="q" defaultValue={query.q} placeholder="Search name, email, or phone" />
        <button className={buttonClass} type="submit">
          Search
        </button>
      </form>
      {data.length === 0 ? <Empty>No customers match.</Empty> : null}
      <ul className="divide-y divide-line rounded-lg border border-line bg-card">
        {data.map((customer) => (
          <li key={customer.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <div>
              <TextLink href={`/customers/${customer.id}`}>{customer.name}</TextLink>
              <p className="text-sm text-muted">{[customer.phone, customer.email].filter(Boolean).join(" · ") || "No contact yet"}</p>
            </div>
            <BrandChip name={customer.brandName} />
          </li>
        ))}
      </ul>
    </div>
  );
}
