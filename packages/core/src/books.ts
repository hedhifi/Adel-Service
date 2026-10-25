import { summarizeMoney } from "@adel/db/money";
import {
  billLineItems,
  billPayments,
  bills,
  customers,
  db,
  entityLinks,
  invoiceLineItems,
  invoices,
  payments,
  vendors,
} from "@adel/db";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { AppError } from "./errors";
import { getReconciliation } from "./intercompany";
import { parse } from "./parse";
import { assertOffice, type Actor } from "./permissions";
import { getCompanySettings, getEntity } from "./settings";
import { buildXlsx, type Sheet } from "./xlsx";

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const rangeSchema = z.object({
  from: daySchema.optional(),
  to: daySchema.optional(),
  asOf: daySchema.optional(),
});

export type LedgerLine = {
  date: string;
  kind: "invoice" | "payment" | "bill" | "bill_payment";
  document: string;
  party: string;
  memo: string;
  account: string;
  debitCents: number;
  creditCents: number;
};

export type AgingRow = {
  number: number;
  customer: string;
  issuedOn: string;
  dueOn: string;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  daysPastDue: number;
  bucket: "current" | "1-30" | "31-60" | "61-90" | "91+";
};

const LEDGER_HEADER = ["Date", "Kind", "Document", "Party", "Memo", "Account", "Debit", "Credit"];

function zonedDay(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function daysBetween(earlier: string, later: string) {
  const start = Date.parse(`${earlier}T00:00:00Z`);
  const end = Date.parse(`${later}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

function bucketFor(daysPastDue: number): AgingRow["bucket"] {
  if (daysPastDue <= 0) return "current";
  if (daysPastDue <= 30) return "1-30";
  if (daysPastDue <= 60) return "31-60";
  if (daysPastDue <= 90) return "61-90";
  return "91+";
}

function dollars(cents: number) {
  return Math.round(cents) / 100;
}

function csvCell(value: string | number) {
  const text = String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function onOrBefore(date: Date | null, day: string, timeZone: string) {
  if (!date) return false;
  return zonedDay(date, timeZone) <= day;
}

function inSpan(day: string, from?: string, to?: string) {
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

function priceDocs(
  docs: Array<{ id: string; number: number; status: string; issuedAt: Date | null; dueAt: Date | null; taxRateBps: number }>,
  lines: Array<{ parentId: string; quantity: string; unitAmountCents: number; taxable: boolean }>,
) {
  return docs.map((doc) => {
    const own = lines.filter((line) => line.parentId === doc.id);
    const summary =
      own.length === 0
        ? { subtotalCents: 0, taxCents: 0, totalCents: 0 }
        : summarizeMoney(own, doc.taxRateBps);
    return { ...doc, subtotalCents: summary.subtotalCents, taxCents: summary.taxCents, totalCents: summary.totalCents };
  });
}

async function loadBook(actor: Actor, range: { from?: string; to?: string; asOf?: string }) {
  const [settings, entity] = await Promise.all([getCompanySettings(), getEntity(actor)]);
  const timeZone = settings.timeZone;
  const asOf = range.asOf ?? zonedDay(new Date(), timeZone);
  if (range.from && range.to && range.from > range.to) {
    throw new AppError(400, "The start date is after the end date.", "invalid_input");
  }

  const invoiceRows = await db.select().from(invoices).where(eq(invoices.entityId, actor.entityId));
  const invoiceIds = invoiceRows.map((row) => row.id);
  const invoiceLines =
    invoiceIds.length === 0
      ? []
      : await db.select().from(invoiceLineItems).where(inArray(invoiceLineItems.invoiceId, invoiceIds));
  const paymentRows =
    invoiceIds.length === 0 ? [] : await db.select().from(payments).where(inArray(payments.invoiceId, invoiceIds));
  const customerRows = await db
    .select({ id: customers.id, name: customers.name })
    .from(customers)
    .where(eq(customers.entityId, actor.entityId));
  const customerName = new Map(customerRows.map((row) => [row.id, row.name]));

  const billRows = await db.select().from(bills).where(eq(bills.entityId, actor.entityId));
  const billIds = billRows.map((row) => row.id);
  const billLines = billIds.length === 0 ? [] : await db.select().from(billLineItems).where(inArray(billLineItems.billId, billIds));
  const billPayRows = billIds.length === 0 ? [] : await db.select().from(billPayments).where(inArray(billPayments.billId, billIds));
  const vendorRows = await db.select({ id: vendors.id, name: vendors.name }).from(vendors).where(eq(vendors.entityId, actor.entityId));
  const vendorName = new Map(vendorRows.map((row) => [row.id, row.name]));

  const links = await db
    .select()
    .from(entityLinks)
    .where(and(eq(entityLinks.kind, "intercompany_invoice"), eq(entityLinks.fromEntityId, actor.entityId)));
  const intercompanyInvoiceIds = new Set(links.map((link) => link.fromRecordId));

  const pricedInvoices = priceDocs(
    invoiceRows,
    invoiceLines.map((line) => ({
      parentId: line.invoiceId,
      quantity: line.quantity,
      unitAmountCents: line.unitAmountCents,
      taxable: line.taxable,
    })),
  );
  const pricedBills = priceDocs(
    billRows,
    billLines.map((line) => ({
      parentId: line.billId,
      quantity: line.quantity,
      unitAmountCents: line.unitAmountCents,
      taxable: line.taxable,
    })),
  );
  const invoiceById = new Map(pricedInvoices.map((row) => [row.id, row]));

  const ledger: LedgerLine[] = [];
  const aging: AgingRow[] = [];
  const revenue = new Map<string, { serviceRevenueCents: number; intercompanyRevenueCents: number; taxCents: number; invoiceCount: number }>();
  const received: Array<{
    date: string;
    document: string;
    party: string;
    method: string;
    reference: string;
    amountCents: number;
    intercompany: boolean;
  }> = [];

  for (const invoice of pricedInvoices) {
    if (invoice.status === "draft" || invoice.status === "void" || !invoice.issuedAt) continue;
    if (!onOrBefore(invoice.issuedAt, asOf, timeZone)) continue;
    const issuedOn = zonedDay(invoice.issuedAt, timeZone);
    const dueOn = zonedDay(invoice.dueAt ?? invoice.issuedAt, timeZone);
    const party = customerName.get(invoiceRows.find((row) => row.id === invoice.id)?.customerId ?? "") ?? "";
    const intercompany = intercompanyInvoiceIds.has(invoice.id);
    const receivable = intercompany ? "Intercompany receivable" : "Accounts receivable";
    const revenueAccount = intercompany ? "Intercompany revenue" : "Service revenue";
    const inPeriod = inSpan(issuedOn, range.from, range.to);
    if (inPeriod) {
      ledger.push(
        line(issuedOn, "invoice", `INV-${invoice.number}`, party, "Invoice issued", receivable, invoice.totalCents, 0),
        line(issuedOn, "invoice", `INV-${invoice.number}`, party, "Invoice issued", revenueAccount, 0, invoice.subtotalCents),
      );
      if (invoice.taxCents) {
        ledger.push(line(issuedOn, "invoice", `INV-${invoice.number}`, party, "Sales tax", "Sales tax payable", 0, invoice.taxCents));
      }
      const period = issuedOn.slice(0, 7);
      const bucket = revenue.get(period) ?? { serviceRevenueCents: 0, intercompanyRevenueCents: 0, taxCents: 0, invoiceCount: 0 };
      if (intercompany) bucket.intercompanyRevenueCents += invoice.subtotalCents;
      else bucket.serviceRevenueCents += invoice.subtotalCents;
      bucket.taxCents += invoice.taxCents;
      bucket.invoiceCount += 1;
      revenue.set(period, bucket);
    }

    const paidCents = paymentRows
      .filter(
        (payment) =>
          payment.invoiceId === invoice.id &&
          payment.status === "succeeded" &&
          onOrBefore(payment.receivedAt ?? payment.createdAt, asOf, timeZone),
      )
      .reduce((sum, payment) => sum + payment.amountCents, 0);
    const balanceCents = invoice.totalCents - paidCents;
    if (balanceCents > 0) {
      const daysPastDue = daysBetween(dueOn, asOf);
      aging.push({
        number: invoice.number,
        customer: party,
        issuedOn,
        dueOn,
        totalCents: invoice.totalCents,
        paidCents,
        balanceCents,
        daysPastDue,
        bucket: bucketFor(daysPastDue),
      });
    }
  }

  for (const payment of paymentRows) {
    if (payment.status !== "succeeded") continue;
    const when = payment.receivedAt ?? payment.createdAt;
    if (!onOrBefore(when, asOf, timeZone)) continue;
    const day = zonedDay(when, timeZone);
    if (!inSpan(day, range.from, range.to)) continue;
    const invoice = invoiceById.get(payment.invoiceId);
    if (!invoice || invoice.status === "draft" || invoice.status === "void") continue;
    const source = invoiceRows.find((row) => row.id === payment.invoiceId);
    const party = customerName.get(source?.customerId ?? "") ?? "";
    const intercompany = intercompanyInvoiceIds.has(payment.invoiceId);
    const receivable = intercompany ? "Intercompany receivable" : "Accounts receivable";
    const document = `INV-${invoice.number}`;
    const memo = payment.reference?.trim() || payment.method;
    ledger.push(
      line(day, "payment", document, party, memo, "Cash", payment.amountCents, 0),
      line(day, "payment", document, party, memo, receivable, 0, payment.amountCents),
    );
    received.push({
      date: day,
      document,
      party,
      method: payment.method,
      reference: payment.reference ?? "",
      amountCents: payment.amountCents,
      intercompany,
    });
  }

  for (const bill of pricedBills) {
    if (bill.status === "draft" || bill.status === "void" || !bill.issuedAt) continue;
    if (!onOrBefore(bill.issuedAt, asOf, timeZone)) continue;
    const issuedOn = zonedDay(bill.issuedAt, timeZone);
    if (!inSpan(issuedOn, range.from, range.to)) continue;
    const source = billRows.find((row) => row.id === bill.id);
    const party = vendorName.get(source?.vendorId ?? "") ?? "";
    ledger.push(
      line(issuedOn, "bill", `BILL-${bill.number}`, party, "Bill from the other company", "Intercompany expense", bill.totalCents, 0),
      line(issuedOn, "bill", `BILL-${bill.number}`, party, "Bill from the other company", "Accounts payable", 0, bill.totalCents),
    );
  }

  for (const payment of billPayRows) {
    if (payment.status !== "succeeded") continue;
    const when = payment.receivedAt ?? payment.createdAt;
    if (!onOrBefore(when, asOf, timeZone)) continue;
    const day = zonedDay(when, timeZone);
    if (!inSpan(day, range.from, range.to)) continue;
    const bill = pricedBills.find((row) => row.id === payment.billId);
    if (!bill || bill.status === "draft" || bill.status === "void") continue;
    const source = billRows.find((row) => row.id === payment.billId);
    const party = vendorName.get(source?.vendorId ?? "") ?? "";
    const memo = payment.reference?.trim() || payment.method;
    ledger.push(
      line(day, "bill_payment", `BILL-${bill.number}`, party, memo, "Accounts payable", payment.amountCents, 0),
      line(day, "bill_payment", `BILL-${bill.number}`, party, memo, "Cash", 0, payment.amountCents),
    );
  }

  ledger.sort((a, b) => a.date.localeCompare(b.date) || a.document.localeCompare(b.document) || b.debitCents - a.debitCents);
  aging.sort((a, b) => b.daysPastDue - a.daysPastDue || a.number - b.number);
  received.sort((a, b) => a.date.localeCompare(b.date) || a.document.localeCompare(b.document));

  const accounts = new Map<string, { debitCents: number; creditCents: number }>();
  for (const entry of ledger) {
    const account = accounts.get(entry.account) ?? { debitCents: 0, creditCents: 0 };
    account.debitCents += entry.debitCents;
    account.creditCents += entry.creditCents;
    accounts.set(entry.account, account);
  }

  const reconciliation = await getReconciliation(actor);
  const month = asOf.slice(0, 7);
  const revenueRows = [...revenue.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([period, amounts]) => ({ period, ...amounts }));
  const thisMonth = revenueRows.find((row) => row.period === month);
  const paymentsThisMonthCents = received.filter((row) => row.date.startsWith(month)).reduce((sum, row) => sum + row.amountCents, 0);

  return {
    companyName: entity.name,
    slug: entity.slug,
    timeZone,
    asOf,
    from: range.from ?? null,
    to: range.to ?? null,
    openReceivableCents: aging.reduce((sum, row) => sum + row.balanceCents, 0),
    revenueThisMonthCents: (thisMonth?.serviceRevenueCents ?? 0) + (thisMonth?.intercompanyRevenueCents ?? 0),
    paymentsThisMonthCents,
    intercompany: reconciliation.data,
    accounts: [...accounts.entries()].map(([account, amounts]) => ({ account, ...amounts })).sort((a, b) => a.account.localeCompare(b.account)),
    ledger,
    aging,
    revenue: revenueRows,
    payments: received,
  };
}

function line(
  date: string,
  kind: LedgerLine["kind"],
  document: string,
  party: string,
  memo: string,
  account: string,
  debitCents: number,
  creditCents: number,
): LedgerLine {
  return { date, kind, document, party, memo, account, debitCents, creditCents };
}

export async function getBooks(actor: Actor, query: { from?: unknown; to?: unknown; asOf?: unknown } = {}) {
  assertOffice(actor);
  const range = parse(rangeSchema, {
    from: empty(query.from),
    to: empty(query.to),
    asOf: empty(query.asOf),
  });
  return { data: await loadBook(actor, range) };
}

function empty(value: unknown) {
  if (value == null || value === "") return undefined;
  return value;
}

function sheetsFor(report: string, book: Awaited<ReturnType<typeof loadBook>>): Sheet[] {
  const balances: Sheet = {
    name: "Balances",
    rows: [
      ["Account", "Debit", "Credit"],
      ...book.accounts.map((row) => [row.account, dollars(row.debitCents), dollars(row.creditCents)]),
    ],
  };
  const ledger: Sheet = {
    name: "Ledger",
    rows: [
      LEDGER_HEADER,
      ...book.ledger.map((row) => [
        row.date,
        row.kind,
        row.document,
        row.party,
        row.memo,
        row.account,
        dollars(row.debitCents),
        dollars(row.creditCents),
      ]),
    ],
  };
  const aging: Sheet = {
    name: "AR aging",
    rows: [
      ["Invoice", "Customer", "Issued", "Due", "Total", "Paid", "Balance", "Days past due", "Bucket"],
      ...book.aging.map((row) => [
        `INV-${row.number}`,
        row.customer,
        row.issuedOn,
        row.dueOn,
        dollars(row.totalCents),
        dollars(row.paidCents),
        dollars(row.balanceCents),
        row.daysPastDue,
        row.bucket,
      ]),
    ],
  };
  const revenue: Sheet = {
    name: "Revenue",
    rows: [
      ["Period", "Service revenue", "Intercompany revenue", "Sales tax", "Invoices"],
      ...book.revenue.map((row) => [
        row.period,
        dollars(row.serviceRevenueCents),
        dollars(row.intercompanyRevenueCents),
        dollars(row.taxCents),
        row.invoiceCount,
      ]),
    ],
  };
  const payments: Sheet = {
    name: "Payments",
    rows: [
      ["Date", "Invoice", "Customer", "Method", "Reference", "Amount", "Intercompany"],
      ...book.payments.map((row) => [
        row.date,
        row.document,
        row.party,
        row.method,
        row.reference,
        dollars(row.amountCents),
        row.intercompany ? "yes" : "no",
      ]),
    ],
  };
  const intercompany: Sheet = {
    name: "Intercompany",
    rows: [
      ["Measure", "Amount"],
      ["They owe us", dollars(book.intercompany.receivableCents)],
      ["We owe them", dollars(book.intercompany.payableCents)],
      ["Net", dollars(book.intercompany.netCents)],
      [],
      ["Supplier", "Consumer", "Invoice", "Invoice balance", "Bill", "Bill balance", "In balance"],
      ...book.intercompany.pairs.map((pair) => {
        const invoice = "balanceCents" in pair.invoice ? pair.invoice : null;
        const bill = "balanceCents" in pair.bill ? pair.bill : null;
        return [
          pair.supplierName ?? "",
          pair.consumerName ?? "",
          invoice ? `INV-${invoice.number}` : "",
          invoice ? dollars(invoice.balanceCents) : "",
          bill ? `BILL-${bill.number}` : "",
          bill ? dollars(bill.balanceCents) : "",
          pair.inBalance ? "yes" : "no",
        ];
      }),
    ],
  };
  const all = { balances, ledger, aging, revenue, payments, intercompany };
  if (report === "workbook") return [balances, ledger, aging, revenue, payments, intercompany];
  if (report in all) return [all[report as keyof typeof all]];
  throw new AppError(400, "Choose balances, ledger, aging, revenue, payments, intercompany, or workbook.", "invalid_input");
}

function toCsv(rows: Sheet["rows"]) {
  const body = rows.map((row) => row.map((cell) => csvCell(cell)).join(",")).join("\n");
  return `\uFEFF${body}\n`;
}

export async function exportBooks(
  actor: Actor,
  query: { report?: unknown; format?: unknown; from?: unknown; to?: unknown; asOf?: unknown },
) {
  assertOffice(actor);
  const input = parse(
    rangeSchema.extend({
      report: z.enum(["balances", "ledger", "aging", "revenue", "payments", "intercompany", "workbook"]).default("ledger"),
      format: z.enum(["csv", "xlsx"]).default("csv"),
    }),
    {
      report: empty(query.report),
      format: empty(query.format),
      from: empty(query.from),
      to: empty(query.to),
      asOf: empty(query.asOf),
    },
  );
  if (input.report === "workbook" && input.format === "csv") {
    throw new AppError(400, "The full workbook is an Excel file. Pick one report for CSV.", "invalid_input");
  }
  const book = await loadBook(actor, input);
  const sheets = sheetsFor(input.report, book);
  const stem = `${book.slug}-${input.report === "workbook" ? "books" : input.report}`;
  if (input.format === "xlsx") {
    return {
      filename: `${stem}.xlsx`,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      body: buildXlsx(sheets),
    };
  }
  return {
    filename: `${stem}.csv`,
    contentType: "text/csv; charset=utf-8",
    body: Buffer.from(toCsv(sheets[0].rows), "utf8"),
  };
}
