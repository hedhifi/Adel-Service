import { CardPayment } from "@/components/card-payment";
import { PrintButton } from "@/components/print-button";
import { Flash, PageHeader, StatusPill, buttonClass, ghostClass, inputClass } from "@/components/ui";
import { invoiceNo, money, when } from "@/lib/format";
import { issueInvoiceAction, manualPaymentAction, voidInvoiceAction } from "@/server/actions";
import { requireOffice } from "@/server/session";
import { AppError, getCompanySettings, getInvoice, stripePublishableKey } from "@adel/core";

export default async function InvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const actor = await requireOffice();
  const { id } = await params;
  const query = await searchParams;
  const [{ data }, settings] = await Promise.all([getInvoice(actor, id), getCompanySettings()]);
  let publishable: string | null = null;
  let stripeProblem: string | null = null;
  try {
    publishable = stripePublishableKey();
  } catch (err) {
    stripeProblem = err instanceof AppError ? err.message : "Stripe isn't available.";
  }
  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader
        title={`${invoiceNo(data.number)}`}
        lede={`${settings.legalName} · ${data.customerName}`}
        action={
          <div className="flex items-center gap-2">
            <StatusPill status={data.status} />
            <PrintButton />
          </div>
        }
      />
      <Flash error={query.error} notice={query.notice} />
      <p className="text-sm text-muted">{settings.shopAddress}</p>
      <table className="w-full text-sm">
        <tbody>
          {data.lineItems.map((line) => (
            <tr key={line.id} className="border-b border-line">
              <td className="py-2">{line.description}</td>
              <td className="py-2 text-right">{money(line.amountCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-right text-sm">
        Tax {money(data.taxCents)} · Total {money(data.totalCents)} · Paid {money(data.paidCents)} · Balance {money(data.balanceCents)}
      </p>
      {data.dueAt ? <p className="text-sm text-muted">Due {when(data.dueAt, settings.timeZone)}</p> : null}
      <div className="flex flex-wrap gap-2 no-print">
        {data.status === "draft" ? (
          <form action={issueInvoiceAction}>
            <input type="hidden" name="id" value={id} />
            <button className={buttonClass} type="submit">
              Issue invoice
            </button>
          </form>
        ) : null}
        {data.status === "draft" || data.status === "issued" ? (
          <form action={voidInvoiceAction}>
            <input type="hidden" name="id" value={id} />
            <button className={ghostClass} type="submit">
              Void
            </button>
          </form>
        ) : null}
      </div>
      {data.status === "issued" || data.status === "partial" ? (
        <div className="grid gap-4 no-print md:grid-cols-2">
          <form action={manualPaymentAction} className="space-y-2 rounded-lg border border-line bg-card p-4">
            <h2 className="font-serif text-xl">Check, cash, or other</h2>
            <input type="hidden" name="id" value={id} />
            <select className={inputClass} name="method" defaultValue="check">
              <option value="check">Check</option>
              <option value="cash">Cash</option>
              <option value="other">Other</option>
            </select>
            <input className={inputClass} name="amount" inputMode="decimal" placeholder="Amount" required defaultValue={(data.balanceCents / 100).toFixed(2)} />
            <input className={inputClass} name="reference" placeholder="Check number or note" />
            <button className={buttonClass} type="submit">
              Record payment
            </button>
          </form>
          <div className="rounded-lg border border-line bg-card p-4">
            <h2 className="mb-2 font-serif text-xl">Card</h2>
            {stripeProblem ? <p className="text-sm text-danger">{stripeProblem}</p> : null}
            <CardPayment invoiceId={id} publishableKey={publishable} balanceLabel={money(data.balanceCents)} />
          </div>
        </div>
      ) : null}
      <ul className="text-sm">
        {data.payments.map((payment) => (
          <li key={payment.id}>
            {money(payment.amountCents)} {payment.method} <StatusPill status={payment.status} /> {payment.reference ?? ""}
          </li>
        ))}
      </ul>
    </div>
  );
}
