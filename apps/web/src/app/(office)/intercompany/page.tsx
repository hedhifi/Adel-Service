import { Field, Flash, PageHeader, Panel, StatusPill, buttonClass, ghostClass, inputClass } from "@/components/ui";
import { money } from "@/lib/format";
import { getReconciliation, listIntercompanyRates, listIntercompanyVisits } from "@adel/core";
import {
  chargeVisitAction,
  createChargeAction,
  createRateAction,
  deactivateRateAction,
  generateIntercompanyAction,
  settleIntercompanyAction,
  voidChargeAction,
} from "@/server/books-actions";
import { requireOffice } from "@/server/session";

function hasMoney(value: object): value is { number: number; status: string; totalCents: number; balanceCents: number; qboStatus: string } {
  return "balanceCents" in value;
}

export default async function IntercompanyPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const actor = await requireOffice();
  const query = await searchParams;
  const [reconciliation, rates, visits] = await Promise.all([
    getReconciliation(actor),
    listIntercompanyRates(actor),
    listIntercompanyVisits(actor),
  ]);
  const { data } = reconciliation;
  const both = actor.entities.length > 1;
  const directions = new Map<string, { supplyingEntityId: string; consumingEntityId: string; label: string }>();
  for (const charge of data.openCharges) {
    const key = `${charge.supplyingEntityId}:${charge.consumingEntityId}`;
    directions.set(key, {
      supplyingEntityId: charge.supplyingEntityId,
      consumingEntityId: charge.consumingEntityId,
      label: `${charge.supplierName} bills ${charge.consumerName}`,
    });
  }
  return (
    <div className="space-y-6">
      <PageHeader
        title="Between companies"
        lede={`${data.companyName ?? "This company"} keeps its own invoice or bill. The other company's copy is a separate document, linked without a foreign key, and each one syncs to its own QuickBooks company.`}
      />
      <Flash error={query.error} notice={query.notice} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Panel>
          <p className="text-sm text-muted">They owe us</p>
          <p className="font-serif text-3xl">{money(data.receivableCents)}</p>
        </Panel>
        <Panel>
          <p className="text-sm text-muted">We owe them</p>
          <p className="font-serif text-3xl">{money(data.payableCents)}</p>
        </Panel>
        <Panel>
          <p className="text-sm text-muted">Net for {data.companyName}</p>
          <p className="font-serif text-3xl">{money(data.netCents)}</p>
        </Panel>
      </div>
      <Panel>
        <h2 className="mb-3 font-serif text-xl">Open charges</h2>
        {data.openCharges.length === 0 ? <p className="text-sm text-muted">No open charges for this company.</p> : null}
        <ul className="divide-y divide-line">
          {data.openCharges.map((charge) => (
            <li key={charge.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span>
                <span className="font-semibold">{charge.description}</span>
                <span className="block text-muted">
                  {charge.supplierName} → {charge.consumerName} · {charge.quantity} × {money(charge.unitAmountCents)}
                </span>
              </span>
              <span>{money(charge.amountCents)}</span>
              <StatusPill status={charge.kind} />
              <form action={voidChargeAction}>
                <input type="hidden" name="id" value={charge.id} />
                <button className="text-sm text-danger" type="submit">
                  Void
                </button>
              </form>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          {[...directions.values()].map((direction) => (
            <form key={`${direction.supplyingEntityId}-${direction.consumingEntityId}`} action={generateIntercompanyAction}>
              <input type="hidden" name="supplyingEntityId" value={direction.supplyingEntityId} />
              <input type="hidden" name="consumingEntityId" value={direction.consumingEntityId} />
              <button className={buttonClass} type="submit">
                Invoice {direction.label}
              </button>
            </form>
          ))}
        </div>
      </Panel>
      <Panel>
        <h2 className="mb-3 font-serif text-xl">Reconciliation</h2>
        {data.pairs.length === 0 ? <p className="text-sm text-muted">No intercompany invoices yet.</p> : null}
        <ul className="space-y-3">
          {data.pairs.map((pair) => {
            const invoice = hasMoney(pair.invoice) ? pair.invoice : null;
            const bill = hasMoney(pair.bill) ? pair.bill : null;
            const open = invoice && bill ? Math.min(invoice.balanceCents, bill.balanceCents) : (invoice?.balanceCents ?? bill?.balanceCents ?? 0);
            return (
              <li key={pair.linkId} className="rounded-md border border-line px-3 py-3 text-sm">
                <p className="font-semibold">
                  {pair.supplierName} invoice {invoice ? invoice.number : "in the other book"} · {pair.consumerName} bill {bill ? bill.number : "in the other book"}
                </p>
                <p className="text-muted">
                  {invoice ? `${money(invoice.totalCents)} · ${invoice.status} · QuickBooks ${invoice.qboStatus}` : "Invoice is in the other company's book."}
                  {bill ? ` · Bill ${bill.status} · QuickBooks ${bill.qboStatus}` : ""}
                  {pair.inBalance ? " · Amounts match" : " · Amounts differ"}
                  {pair.bothPosted ? " · Both QuickBooks companies have it" : ""}
                </p>
                {both && open > 0 ? (
                  <form action={settleIntercompanyAction} className="mt-2 flex flex-wrap items-end gap-2">
                    <input type="hidden" name="linkId" value={pair.linkId} />
                    <Field label="Settle (dollars)">
                      <input className={inputClass} name="amount" defaultValue={(open / 100).toFixed(2)} />
                    </Field>
                    <Field label="Reference">
                      <input className={inputClass} name="reference" placeholder="ACH" />
                    </Field>
                    <button className={ghostClass} type="submit">
                      Record in both books
                    </button>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Panel>
      <Panel>
        <h2 className="mb-3 font-serif text-xl">Rates</h2>
        <ul className="mb-4 divide-y divide-line">
          {rates.data.length === 0 ? <li className="py-2 text-sm text-muted">No rates yet.</li> : null}
          {rates.data.map((rate) => (
            <li key={rate.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span>
                <span className="font-semibold">{rate.name}</span>
                <span className="block text-muted">
                  {rate.supplierName} → {rate.consumerName} · {money(rate.unitAmountCents)} / {rate.unit}
                </span>
              </span>
              <StatusPill status={rate.active ? rate.kind : "void"} />
              {rate.active ? (
                <form action={deactivateRateAction}>
                  <input type="hidden" name="id" value={rate.id} />
                  <button className="text-pine underline-offset-2 hover:underline" type="submit">
                    Turn off
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
        {both ? (
          <form action={createRateAction} className="grid gap-3 md:grid-cols-2">
            <Field label="Who supplies">
              <select className={inputClass} name="supplyingEntityId" defaultValue={actor.entityId}>
                {actor.entities.map((entity) => (
                  <option key={entity.entityId} value={entity.entityId}>
                    {entity.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Who is billed">
              <select className={inputClass} name="consumingEntityId" defaultValue={actor.entities.find((entity) => entity.entityId !== actor.entityId)?.entityId}>
                {actor.entities.map((entity) => (
                  <option key={entity.entityId} value={entity.entityId}>
                    {entity.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Name">
              <input className={inputClass} name="name" required placeholder="Field technician hour" />
            </Field>
            <Field label="Kind">
              <select className={inputClass} name="kind" defaultValue="labor">
                <option value="labor">Labor</option>
                <option value="material">Material</option>
                <option value="shared">Shared cost</option>
              </select>
            </Field>
            <Field label="Unit">
              <input className={inputClass} name="unit" defaultValue="hour" required />
            </Field>
            <Field label="Rate (dollars)">
              <input className={inputClass} name="price" defaultValue="95.00" required />
            </Field>
            <div className="md:col-span-2">
              <button className={buttonClass} type="submit">
                Save rate
              </button>
            </div>
          </form>
        ) : (
          <p className="text-sm text-muted">A login that belongs to both companies can set rates.</p>
        )}
      </Panel>
      {both ? (
        <Panel className="space-y-4">
          <h2 className="font-serif text-xl">Record a charge</h2>
          {visits.data.length > 0 && rates.data.some((rate) => rate.active) ? (
          <form action={chargeVisitAction} className="grid gap-3 md:grid-cols-3">
            <Field label="Visit">
              <select className={inputClass} name="visitId" required>
                {visits.data.map((visit) => (
                  <option key={visit.id} value={visit.id}>
                    {visit.entityName}: {visit.jobTitle} ({visit.quantity} h)
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Company that supplies the tech">
              <select className={inputClass} name="supplyingEntityId" defaultValue={actor.entities.find((entity) => entity.entityId !== actor.entityId)?.entityId}>
                {actor.entities.map((entity) => (
                  <option key={entity.entityId} value={entity.entityId}>
                    {entity.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Rate">
              <select className={inputClass} name="rateId" required>
                {rates.data.filter((rate) => rate.active).map((rate) => (
                  <option key={rate.id} value={rate.id}>
                    {rate.name} ({rate.supplierName})
                  </option>
                ))}
              </select>
            </Field>
            <div className="md:col-span-3">
              <button className={buttonClass} type="submit">
                Charge this visit
              </button>
            </div>
          </form>
          ) : (
            <p className="text-sm text-muted">Add a rate before charging a visit.</p>
          )}
          <form action={createChargeAction} className="grid gap-3 border-t border-line pt-4 md:grid-cols-2">
            <Field label="Supplying company">
              <select className={inputClass} name="supplyingEntityId" defaultValue={actor.entityId}>
                {actor.entities.map((entity) => (
                  <option key={entity.entityId} value={entity.entityId}>
                    {entity.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Billed company">
              <select className={inputClass} name="consumingEntityId" defaultValue={actor.entities.find((entity) => entity.entityId !== actor.entityId)?.entityId}>
                {actor.entities.map((entity) => (
                  <option key={entity.entityId} value={entity.entityId}>
                    {entity.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Rate">
              <select className={inputClass} name="rateId" required>
                {rates.data.filter((rate) => rate.active).map((rate) => (
                  <option key={rate.id} value={rate.id}>
                    {rate.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Quantity">
              <input className={inputClass} name="quantity" defaultValue="1.00" required />
            </Field>
            <Field label="Amount override (dollars, optional)">
              <input className={inputClass} name="price" placeholder="At cost" />
            </Field>
            <Field label="Description">
              <input className={inputClass} name="description" required placeholder="Shared materials" />
            </Field>
            <div className="md:col-span-2">
              <button className={ghostClass} type="submit">
                Record charge
              </button>
            </div>
          </form>
        </Panel>
      ) : null}
    </div>
  );
}
