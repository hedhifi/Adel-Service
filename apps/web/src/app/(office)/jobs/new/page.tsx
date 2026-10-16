import { CustomerPicker } from "@/components/customer-picker";
import { Field, Flash, PageHeader, buttonClass, inputClass } from "@/components/ui";
import { createJobAction } from "@/server/actions";
import { loadPicker } from "@/server/picker";
import { requireOffice } from "@/server/session";

export default async function NewJobPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireOffice();
  const query = await searchParams;
  const customers = await loadPicker();
  return (
    <div className="max-w-2xl">
      <PageHeader title="New job" lede="Use this for time-and-materials work that did not start as an estimate." />
      <form action={createJobAction} className="space-y-3">
        <Flash error={query.error} />
        <CustomerPicker customers={customers} />
        <Field label="Title">
          <input className={inputClass} name="title" required />
        </Field>
        <Field label="Instructions for the crew">
          <textarea className={inputClass} name="instructions" rows={4} />
        </Field>
        <button className={buttonClass} type="submit">
          Save job
        </button>
      </form>
    </div>
  );
}
