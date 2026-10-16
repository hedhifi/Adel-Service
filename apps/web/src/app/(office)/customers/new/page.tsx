import { Field, Flash, PageHeader, buttonClass, inputClass } from "@/components/ui";
import { createCustomerAction } from "@/server/actions";
import { requireOffice } from "@/server/session";
import { listBrands } from "@adel/core";

export default async function NewCustomerPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const actor = await requireOffice();
  const { data: brands } = await listBrands(actor);
  const query = await searchParams;
  return (
    <div className="max-w-2xl">
      <PageHeader title="New customer" lede="Add the person or household, and the first service location if you have it." />
      <form action={createCustomerAction} className="space-y-3">
        <Flash error={query.error} />
        <Field label="Name">
          <input className={inputClass} name="name" required />
        </Field>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Email">
            <input className={inputClass} name="email" type="email" />
          </Field>
          <Field label="Phone">
            <input className={inputClass} name="phone" />
          </Field>
        </div>
        <Field label="Brand">
          <select className={inputClass} name="brandId" required>
            {brands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Notes">
          <textarea className={inputClass} name="notes" rows={3} />
        </Field>
        <h2 className="pt-2 font-serif text-xl">Service location</h2>
        <Field label="Label">
          <input className={inputClass} name="label" placeholder="House, condo, dock..." />
        </Field>
        <Field label="Street">
          <input className={inputClass} name="line1" />
        </Field>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="City">
            <input className={inputClass} name="city" />
          </Field>
          <Field label="State">
            <input className={inputClass} name="state" defaultValue="FL" />
          </Field>
          <Field label="ZIP">
            <input className={inputClass} name="postalCode" />
          </Field>
        </div>
        <Field label="Access notes">
          <textarea className={inputClass} name="accessNotes" rows={2} placeholder="Gate code, dogs, where to park" />
        </Field>
        <button className={buttonClass} type="submit">
          Save customer
        </button>
      </form>
    </div>
  );
}
