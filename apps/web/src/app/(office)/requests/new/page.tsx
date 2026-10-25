import { CustomerPicker } from "@/components/customer-picker";
import { Field, Flash, PageHeader, buttonClass, inputClass } from "@/components/ui";
import { createRequestAction } from "@/server/actions";
import { loadPicker } from "@/server/picker";
import { requireOffice } from "@/server/session";

export default async function NewRequestPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireOffice();
  const query = await searchParams;
  const customers = await loadPicker();
  return (
    <div className="max-w-2xl">
      <PageHeader title="New request" lede="Write down what the customer asked for. An estimate comes next." />
      {customers.length === 0 ? <p>Add a customer with a service location first.</p> : null}
      <form action={createRequestAction} className="space-y-3">
        <Flash error={query.error} />
        <CustomerPicker customers={customers} />
        <Field label="Title">
          <input className={inputClass} name="title" required />
        </Field>
        <Field label="What they need">
          <textarea className={inputClass} name="description" rows={5} required />
        </Field>
        <Field label="How it came in">
          <select className={inputClass} name="source" defaultValue="phone">
            <option value="phone">Phone</option>
            <option value="email">Email</option>
            <option value="in_person">In person</option>
            <option value="web">Web</option>
            <option value="other">Other</option>
          </select>
        </Field>
        <button className={buttonClass} type="submit" disabled={customers.length === 0}>
          Save request
        </button>
      </form>
    </div>
  );
}
