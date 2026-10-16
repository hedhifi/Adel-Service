import { CustomerPicker } from "@/components/customer-picker";
import { LineItemsEditor } from "@/components/line-items-editor";
import { Field, Flash, PageHeader, buttonClass, inputClass } from "@/components/ui";
import { createQuoteAction } from "@/server/actions";
import { loadPicker } from "@/server/picker";
import { requireOffice } from "@/server/session";
import { getCompanySettings, getRequest } from "@adel/core";

export default async function NewQuotePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; requestId?: string }>;
}) {
  const actor = await requireOffice();
  const query = await searchParams;
  const customers = await loadPicker();
  const settings = await getCompanySettings();
  const request = query.requestId ? (await getRequest(actor, query.requestId)).data : null;
  return (
    <div className="max-w-3xl">
      <PageHeader title="New estimate" lede="Labor is not taxed by default. Materials are. Change the tax percent if this county is different." />
      <form action={createQuoteAction} className="space-y-4">
        <Flash error={query.error} />
        {request ? <input type="hidden" name="requestId" value={request.id} /> : null}
        <CustomerPicker
          customers={customers}
          customerId={request?.customerId}
          propertyId={request?.propertyId}
          brandId={request?.brandId}
        />
        <Field label="Title">
          <input className={inputClass} name="title" required defaultValue={request?.title ?? ""} />
        </Field>
        <Field label="Notes for the customer">
          <textarea className={inputClass} name="notes" rows={3} defaultValue={request?.description ?? ""} />
        </Field>
        <Field label="Tax percent">
          <input className={inputClass} name="taxPercent" defaultValue={(settings.defaultTaxRateBps / 100).toFixed(2)} />
        </Field>
        <LineItemsEditor />
        <button className={buttonClass} type="submit">
          Save draft
        </button>
      </form>
    </div>
  );
}
