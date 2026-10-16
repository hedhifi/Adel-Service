import { summarizeMoney, type PricedLine } from "@adel/db/money";
import {
  customers,
  db,
  invoiceLineItems,
  invoices,
  jobs,
  payments,
  quoteLineItems,
  quotes,
  visits,
} from "@adel/db";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { nextNumber, type Tx } from "./db";
import { AppError, notFound } from "./errors";
import { lineItemSchema, pageSchema, parse, type LineInput } from "./parse";
import { assertOffice, type Actor } from "./permissions";
import { assertActiveBook } from "./scope";
import { getEntity } from "./settings";
import { emitEvent, safeDeliver } from "./webhooks";

function priceLines(lines: PricedLine[], taxRateBps: number) {
  try {
    return summarizeMoney(lines, taxRateBps);
  } catch (err) {
    throw new AppError(400, err instanceof Error ? err.message : "Invalid line items.", "invalid_line");
  }
}

async function loadInvoice(id: string) {
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id));
  if (!invoice) throw notFound("Invoice not found.");
  const lines = await db
    .select()
    .from(invoiceLineItems)
    .where(eq(invoiceLineItems.invoiceId, id))
    .orderBy(invoiceLineItems.position);
  const summary = priceLines(
    lines.map((line) => ({
      kind: line.kind,
      description: line.description,
      quantity: line.quantity,
      unitAmountCents: line.unitAmountCents,
      taxable: line.taxable,
    })),
    invoice.taxRateBps,
  );
  const payRows = await db.select().from(payments).where(eq(payments.invoiceId, id)).orderBy(desc(payments.createdAt));
  const paidCents = payRows.filter((payment) => payment.status === "succeeded").reduce((sum, payment) => sum + payment.amountCents, 0);
  const [customer] = await db.select().from(customers).where(eq(customers.id, invoice.customerId));
  return {
    data: {
      ...invoice,
      customerName: customer?.name ?? null,
      lineItems: lines.map((line, index) => ({
        ...line,
        amountCents: summary.lines[index]?.amountCents ?? 0,
      })),
      subtotalCents: summary.subtotalCents,
      taxCents: summary.taxCents,
      totalCents: summary.totalCents,
      paidCents,
      balanceCents: summary.totalCents - paidCents,
      payments: payRows.map((payment) => ({
        id: payment.id,
        amountCents: payment.amountCents,
        status: payment.status,
        method: payment.method,
        reference: payment.reference,
        stripePaymentIntentId: payment.stripePaymentIntentId,
        receivedAt: payment.receivedAt,
        createdAt: payment.createdAt,
      })),
    },
  };
}

async function refreshInvoiceStatus(tx: Tx, invoiceId: string) {
  const lines = await tx.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, invoiceId));
  const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!invoice) throw notFound("Invoice not found.");
  if (invoice.status === "draft" || invoice.status === "void") return invoice;
  const summary = priceLines(
    lines.map((line) => ({
      quantity: line.quantity,
      unitAmountCents: line.unitAmountCents,
      taxable: line.taxable,
    })),
    invoice.taxRateBps,
  );
  const payRows = await tx.select().from(payments).where(eq(payments.invoiceId, invoiceId));
  const paidCents = payRows.filter((payment) => payment.status === "succeeded").reduce((sum, payment) => sum + payment.amountCents, 0);
  const status = paidCents <= 0 ? "issued" : paidCents < summary.totalCents ? "partial" : "paid";
  if (status !== invoice.status) {
    await tx.update(invoices).set({ status, updatedAt: new Date() }).where(eq(invoices.id, invoiceId));
  }
  return { ...invoice, status };
}

export async function assertCanCollect(actor: Actor, invoiceId: string) {
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!invoice) throw notFound("Invoice not found.");
  assertActiveBook(actor, invoice.entityId);
  if (actor.role === "admin" || actor.role === "office") return invoice;
  if (!invoice.jobId) throw new AppError(403, "You can't collect on this invoice.", "forbidden");
  const [visit] = await db
    .select({ id: visits.id })
    .from(visits)
    .where(and(eq(visits.jobId, invoice.jobId), eq(visits.technicianId, actor.id)))
    .limit(1);
  if (!visit) throw new AppError(403, "You can collect payment only on jobs assigned to you.", "forbidden");
  return invoice;
}

export async function listInvoices(
  actor: Actor,
  query: { status?: string; customerId?: string; limit?: unknown; offset?: unknown } = {},
) {
  assertOffice(actor);
  const page = parse(pageSchema, { limit: query.limit ?? 50, offset: query.offset ?? 0 });
  const filters = [eq(invoices.entityId, actor.entityId)];
  if (query.status) {
    const status = parse(z.enum(["draft", "issued", "partial", "paid", "void"]), query.status);
    filters.push(eq(invoices.status, status));
  }
  if (query.customerId) filters.push(eq(invoices.customerId, query.customerId));
  const where = and(...filters);
  const [countRow] = await db.select({ total: sql<number>`count(*)::int` }).from(invoices).where(where);
  const rows = await db
    .select({
      id: invoices.id,
      number: invoices.number,
      status: invoices.status,
      customerId: invoices.customerId,
      customerName: customers.name,
      jobId: invoices.jobId,
      issuedAt: invoices.issuedAt,
      createdAt: invoices.createdAt,
    })
    .from(invoices)
    .innerJoin(customers, eq(customers.id, invoices.customerId))
    .where(where)
    .orderBy(desc(invoices.createdAt))
    .limit(page.limit)
    .offset(page.offset);
  return { data: rows, total: countRow?.total ?? 0 };
}

export async function getInvoice(actor: Actor, id: string) {
  await assertCanCollect(actor, id);
  return loadInvoice(id);
}

export async function createInvoice(actor: Actor, input: unknown) {
  assertOffice(actor);
  const data = parse(
    z.object({
      jobId: z.string().uuid(),
      notes: z.string().trim().max(2000).optional(),
      lineItems: z.array(lineItemSchema).min(1).max(80).optional(),
    }),
    input,
  );
  const entity = await getEntity(actor);
  const id = await db.transaction(async (tx) => {
    const [job] = await tx.select().from(jobs).where(eq(jobs.id, data.jobId));
    if (!job) throw notFound("Job not found.");
    assertActiveBook(actor, job.entityId);
    const [existing] = await tx
      .select()
      .from(invoices)
      .where(and(eq(invoices.jobId, job.id), ne(invoices.status, "void")));
    if (existing) throw new AppError(409, "This job already has an invoice.", "invoice_exists");
    let lines = data.lineItems;
    let taxRateBps = entity.taxRateBps;
    if (!lines) {
      if (!job.quoteId) throw new AppError(400, "Add line items. This job has no estimate to copy.", "line_items_required");
      const [quote] = await tx.select().from(quotes).where(eq(quotes.id, job.quoteId));
      if (!quote) throw new AppError(400, "Add line items. This job has no estimate to copy.", "line_items_required");
      taxRateBps = quote.taxRateBps;
      const quoteLines = await tx.select().from(quoteLineItems).where(eq(quoteLineItems.quoteId, quote.id)).orderBy(quoteLineItems.position);
      lines = quoteLines.map((line) => ({
        kind: line.kind,
        description: line.description,
        quantity: line.quantity,
        unitAmountCents: line.unitAmountCents,
        taxable: line.taxable,
      }));
    }
    priceLines(lines, taxRateBps);
    const number = await nextNumber(tx, job.entityId, "invoice");
    const [invoice] = await tx
      .insert(invoices)
      .values({
        entityId: job.entityId,
        number,
        jobId: job.id,
        customerId: job.customerId,
        brandId: job.brandId,
        status: "draft",
        taxRateBps,
        notes: data.notes ?? null,
      })
      .returning();
    await tx.insert(invoiceLineItems).values(
      lines.map((line, index) => ({
        invoiceId: invoice.id,
        position: index,
        kind: line.kind,
        description: line.description,
        quantity: line.quantity,
        unitAmountCents: line.unitAmountCents,
        taxable: line.taxable,
      })),
    );
    return invoice.id;
  });
  return loadInvoice(id);
}

export async function issueInvoice(actor: Actor, id: string) {
  assertOffice(actor);
  await db.transaction(async (tx) => {
    const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, id));
    if (!invoice) throw notFound("Invoice not found.");
    if (invoice.status !== "draft") throw new AppError(409, "Only a draft invoice can be issued.", "invalid_state");
    const lines = await tx.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, id));
    const summary = priceLines(
      lines.map((line) => ({
        quantity: line.quantity,
        unitAmountCents: line.unitAmountCents,
        taxable: line.taxable,
      })),
      invoice.taxRateBps,
    );
    if (summary.totalCents <= 0) throw new AppError(400, "Add an amount before issuing the invoice.", "invalid_line");
    const issuedAt = new Date();
    const dueAt = new Date(issuedAt.getTime() + 15 * 24 * 60 * 60 * 1000);
    await tx.update(invoices).set({ status: "issued", issuedAt, dueAt, updatedAt: issuedAt }).where(eq(invoices.id, id));
    await emitEvent(tx, "invoice.issued", {
      invoiceId: invoice.id,
      number: invoice.number,
      customerId: invoice.customerId,
      totalCents: summary.totalCents,
    }, invoice.entityId);
  });
  await safeDeliver();
  return loadInvoice(id);
}

export async function voidInvoice(actor: Actor, id: string) {
  assertOffice(actor);
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id));
  if (!invoice) throw notFound("Invoice not found.");
  if (invoice.status === "void") return loadInvoice(id);
  const pays = await db.select().from(payments).where(eq(payments.invoiceId, id));
  if (pays.some((payment) => payment.status === "succeeded")) {
    throw new AppError(409, "This invoice has a payment on it, so it can't be voided.", "invalid_state");
  }
  await db.update(invoices).set({ status: "void", updatedAt: new Date() }).where(eq(invoices.id, id));
  return loadInvoice(id);
}

export async function recordManualPayment(actor: Actor, invoiceId: string, input: unknown) {
  assertOffice(actor);
  const data = parse(
    z.object({
      method: z.enum(["check", "cash", "other"]),
      amountCents: z.number().int().positive(),
      reference: z.string().trim().max(80).optional(),
    }),
    input,
  );
  await db.transaction(async (tx) => {
    const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId));
    if (!invoice) throw notFound("Invoice not found.");
    assertActiveBook(actor, invoice.entityId);
    if (invoice.status !== "issued" && invoice.status !== "partial") {
      throw new AppError(409, "Issue the invoice before recording a payment.", "invalid_state");
    }
    const loaded = await loadInvoice(invoiceId);
    if (data.amountCents > loaded.data.balanceCents) {
      throw new AppError(400, "That amount is more than the balance.", "amount_too_high");
    }
    const [payment] = await tx
      .insert(payments)
      .values({
        invoiceId,
        amountCents: data.amountCents,
        status: "succeeded",
        method: data.method,
        reference: data.reference ?? null,
        recordedById: actor.id,
        receivedAt: new Date(),
      })
      .returning();
    await refreshInvoiceStatus(tx, invoiceId);
    await emitEvent(tx, "payment.received", {
      paymentId: payment.id,
      invoiceId,
      amountCents: payment.amountCents,
      method: payment.method,
    }, invoice.entityId);
  });
  await safeDeliver();
  return loadInvoice(invoiceId);
}

export function stripeSecretKey() {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  if (key.startsWith("sk_live_") || key.startsWith("rk_live_")) {
    throw new AppError(500, "Live Stripe keys are refused. Use a test-mode secret key.", "stripe_live_key_blocked");
  }
  if (!key.startsWith("sk_test_") || key.includes("replace")) return null;
  return key;
}

export function stripePublishableKey() {
  const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
  if (key.startsWith("pk_live_")) {
    throw new AppError(500, "Live Stripe keys are refused. Use a test-mode publishable key.", "stripe_live_key_blocked");
  }
  if (!key.startsWith("pk_test_") || key.includes("replace")) return null;
  return key;
}

async function stripeClient() {
  const key = stripeSecretKey();
  if (!key) {
    throw new AppError(503, "Stripe test mode is not configured. Add an sk_test_ key to the environment.", "stripe_not_configured");
  }
  const { default: Stripe } = await import("stripe");
  return new Stripe(key);
}

export async function startCardPayment(actor: Actor, invoiceId: string) {
  const invoice = await assertCanCollect(actor, invoiceId);
  if (invoice.status !== "issued" && invoice.status !== "partial") {
    throw new AppError(409, "Issue the invoice before taking a card.", "invalid_state");
  }
  const loaded = await loadInvoice(invoiceId);
  if (loaded.data.balanceCents <= 0) throw new AppError(409, "This invoice is already paid.", "already_paid");
  const stripe = await stripeClient();
  await db
    .update(payments)
    .set({ status: "canceled" })
    .where(and(eq(payments.invoiceId, invoiceId), eq(payments.status, "processing"), eq(payments.method, "card")));
  const [payment] = await db
    .insert(payments)
    .values({
      invoiceId,
      amountCents: loaded.data.balanceCents,
      status: "processing",
      method: "card",
      recordedById: actor.id,
    })
    .returning();
  try {
    const intent = await stripe.paymentIntents.create({
      amount: loaded.data.balanceCents,
      currency: "usd",
      automatic_payment_methods: { enabled: true },
      metadata: { invoiceId, paymentId: payment.id, invoiceNumber: String(invoice.number) },
    });
    await db.update(payments).set({ stripePaymentIntentId: intent.id }).where(eq(payments.id, payment.id));
    return { data: { paymentId: payment.id, clientSecret: intent.client_secret, amountCents: loaded.data.balanceCents } };
  } catch (err) {
    await db.update(payments).set({ status: "failed" }).where(eq(payments.id, payment.id));
    const message = err instanceof Error ? err.message : "Stripe rejected the payment.";
    throw new AppError(502, message, "stripe_error");
  }
}

export async function markCardPaymentSucceeded(stripePaymentIntentId: string, amountReceived?: number) {
  const updated = await db.transaction(async (tx) => {
    const [payment] = await tx.select().from(payments).where(eq(payments.stripePaymentIntentId, stripePaymentIntentId));
    if (!payment || payment.status === "succeeded") return payment ?? null;
    const amount = amountReceived && amountReceived > 0 ? amountReceived : payment.amountCents;
    await tx
      .update(payments)
      .set({ status: "succeeded", amountCents: amount, receivedAt: new Date() })
      .where(eq(payments.id, payment.id));
    await refreshInvoiceStatus(tx, payment.invoiceId);
    const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, payment.invoiceId));
    await emitEvent(tx, "payment.received", {
      paymentId: payment.id,
      invoiceId: payment.invoiceId,
      amountCents: amount,
      method: "card",
    }, invoice?.entityId ?? payment.invoiceId);
    return payment;
  });
  if (updated && updated.status !== "succeeded") await safeDeliver();
  return updated;
}

export async function syncCardPayment(actor: Actor, invoiceId: string, input: unknown) {
  await assertCanCollect(actor, invoiceId);
  const data = parse(z.object({ paymentId: z.string().uuid() }), input);
  const [payment] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.id, data.paymentId), eq(payments.invoiceId, invoiceId)));
  if (!payment || !payment.stripePaymentIntentId) throw notFound("Card payment not found.");
  const stripe = await stripeClient();
  const intent = await stripe.paymentIntents.retrieve(payment.stripePaymentIntentId);
  if (intent.status === "succeeded") await markCardPaymentSucceeded(intent.id, intent.amount_received);
  if (intent.status === "canceled") {
    await db.update(payments).set({ status: "canceled" }).where(eq(payments.id, payment.id));
  }
  return loadInvoice(invoiceId);
}

export async function handleStripeWebhook(rawBody: string, signature: string | null) {
  const key = stripeSecretKey();
  if (!key) throw new AppError(503, "Stripe test mode is not configured.", "stripe_not_configured");
  const secret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
  if (!secret || secret.includes("replace")) {
    throw new AppError(503, "Stripe webhook secret is not configured.", "stripe_not_configured");
  }
  const stripe = await stripeClient();
  const event = stripe.webhooks.constructEvent(rawBody, signature ?? "", secret);
  if (event.type === "payment_intent.succeeded") {
    const intent = event.data.object;
    await markCardPaymentSucceeded(intent.id, intent.amount_received);
  }
  if (event.type === "payment_intent.payment_failed") {
    const intent = event.data.object;
    await db
      .update(payments)
      .set({ status: "failed" })
      .where(and(eq(payments.stripePaymentIntentId, intent.id), ne(payments.status, "succeeded")));
  }
  return { received: true };
}
