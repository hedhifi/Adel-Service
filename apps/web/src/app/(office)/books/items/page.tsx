import { Field, Flash, PageHeader, StatusPill, buttonClass, ghostClass, inputClass } from "@/components/ui";
import { money } from "@/lib/format";
import { listCatalogItems } from "@adel/core";
import { createItemAction, updateItemAction } from "@/server/books-actions";
import { requireOffice } from "@/server/session";
import Link from "next/link";

export default async function ItemsPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const actor = await requireOffice();
  const query = await searchParams;
  const { data } = await listCatalogItems(actor);
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Products"
        lede="Products and services in this company's book. They are not shared with the other company."
        action={
          <Link className={ghostClass} href="/books">
            Books
          </Link>
        }
      />
      <Flash error={query.error} notice={query.notice} />
      <ul className="divide-y divide-line rounded-lg border border-line bg-card">
        {data.length === 0 ? <li className="px-4 py-6 text-sm text-muted">No products yet.</li> : null}
        {data.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
            <span className="font-semibold">{item.name}</span>
            <span className="text-muted">{item.kind}</span>
            <span>{money(item.unitAmountCents)}</span>
            <StatusPill status={item.active ? "active" : "void"} />
            <form action={updateItemAction}>
              <input type="hidden" name="id" value={item.id} />
              <input type="hidden" name="active" value={item.active ? "false" : "true"} />
              <button className="text-pine underline-offset-2 hover:underline" type="submit">
                {item.active ? "Retire" : "Restore"}
              </button>
            </form>
          </li>
        ))}
      </ul>
      <form action={createItemAction} className="space-y-3 rounded-lg border border-line bg-card p-4">
        <h2 className="font-serif text-xl">Add an item</h2>
        <Field label="Name">
          <input className={inputClass} name="name" required />
        </Field>
        <Field label="Kind">
          <select className={inputClass} name="kind" defaultValue="material">
            <option value="labor">Labor</option>
            <option value="material">Material</option>
            <option value="other">Other</option>
          </select>
        </Field>
        <Field label="Price (dollars)">
          <input className={inputClass} name="price" inputMode="decimal" placeholder="42.00" required />
        </Field>
        <Field label="SKU">
          <input className={inputClass} name="sku" />
        </Field>
        <Field label="Description">
          <input className={inputClass} name="description" />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="taxable" />
          Taxable
        </label>
        <button className={buttonClass} type="submit">
          Save item
        </button>
      </form>
    </div>
  );
}
