import { summarizeMoney, type PricedLine } from "@adel/db/money";
import { newSecret } from "@adel/db/secrets";
import { brands, customers, db, jobs, properties, quoteLineItems, quotes, requests } from "@adel/db";
import { and, desc, eq, ilike, sql } from "drizzle-orm";
import { z } from "zod";
import { nextNumber, type Tx } from "./db";
import { AppError, notFound } from "./errors";
import { lineItemSchema, pageSchema, parse, type LineInput } from "./parse";
import { assertOffice, type Actor } from "./permissions";
import { assertProperty } from "./records";
import { getCompanySettings } from "./settings";
import { emitEvent, safeDeliver } from "./webhooks";

function priceLines(lines: PricedLine[], taxRateBps: number) {
  try {
    return summarizeMoney(lines, taxRateBps);
  } catch (err) {
    throw new AppError(400, err instanceof Error ? err.message : "Invalid line items.", "invalid_line");
  }
}

async function loadQuote(id: string) {
  const [quote] = await db
    .select({
      id: quotes.id,
      number: quotes.number,
      title: quotes.title,
      status: quotes.status,
      taxRateBps: quotes.taxRateBps,
      notes: quotes.notes,
      publicToken: quotes.publicToken,
      validUntil: quotes.validUntil,
      sentAt: quotes.sentAt,
      approvedAt: quotes.approvedAt,
      approvedByName: quotes.approvedByName,
      declinedAt: quotes.declinedAt,
      declineReason: quotes.declineReason,
      customerId: quotes.customerId,
      customerName: customers.name,
      propertyId: quotes.propertyId,
      propertyLabel: properties.label,
      line1: properties.line1,
      line2: properties.line2,
      city: properties.city,
      state: properties.state,
      postalCode: properties.postalCode,
      brandId: quotes.brandId,
      brandName: brands.name,
      requestId: quotes.requestId,
      createdAt: quotes.createdAt,
      updatedAt: quotes.updatedAt,
    })
    .from(quotes)
    .innerJoin(customers, eq(customers.id, quotes.customerId))
    .innerJoin(properties, eq(properties.id, quotes.propertyId))
    .innerJoin(brands, eq(brands.id, quotes.brandId))
    .where(eq(quotes.id, id));
  if (!quote) throw notFound("Estimate not found.");
  const lines = await db.select().from(quoteLineItems).where(eq(quoteLineItems.quoteId, id)).orderBy(quoteLineItems.position);
  const summary = priceLines(
    lines.map((line) => ({
      kind: line.kind,
      description: line.description,
      quantity: line.quantity,
      unitAmountCents: line.unitAmountCents,
      taxable: line.taxable,
    })),
    quote.taxRateBps,
  );
  const lineItems = lines.map((line, index) => ({
    id: line.id,
    position: line.position,
    kind: line.kind,
    description: line.description,
    quantity: line.quantity,
    unitAmountCents: line.unitAmountCents,
    taxable: line.taxable,
    amountCents: summary.lines[index]?.amountCents ?? 0,
  }));
  return {
    data: {
      ...quote,
      lineItems,
      subtotalCents: summary.subtotalCents,
      taxCents: summary.taxCents,
      totalCents: summary.totalCents,
      publicPath: quote.publicToken ? `/q/${quote.publicToken}` : null,
    },
  };
}

export async function listQuotes(
  actor: Actor,
  query: { status?: string; q?: string; customerId?: string; limit?: unknown; offset?: unknown } = {},
) {
  assertOffice(actor);
  const page = parse(pageSchema, { limit: query.limit ?? 50, offset: query.offset ?? 0 });
  const filters = [];
  if (query.status) {
    const status = parse(z.enum(["draft", "sent", "approved", "declined", "expired"]), query.status);
    filters.push(eq(quotes.status, status));
  }
  if (query.customerId) filters.push(eq(quotes.customerId, query.customerId));
  if (query.q?.trim()) filters.push(ilike(quotes.title, `%${query.q.trim().replace(/[%_]/g, "")}%`));
  const where = filters.length ? and(...filters) : undefined;
  const [countRow] = await db.select({ total: sql<number>`count(*)::int` }).from(quotes).where(where);
  const rows = await db
    .select({
      id: quotes.id,
      number: quotes.number,
      title: quotes.title,
      status: quotes.status,
      customerId: quotes.customerId,
      customerName: customers.name,
      brandName: brands.name,
      createdAt: quotes.createdAt,
    })
    .from(quotes)
    .innerJoin(customers, eq(customers.id, quotes.customerId))
    .innerJoin(brands, eq(brands.id, quotes.brandId))
    .where(where)
    .orderBy(desc(quotes.createdAt))
    .limit(page.limit)
    .offset(page.offset);
  return { data: rows, total: countRow?.total ?? 0 };
}

export async function getQuote(actor: Actor, id: string) {
  assertOffice(actor);
  return loadQuote(id);
}

const quoteWrite = z.object({
  customerId: z.string().uuid(),
  propertyId: z.string().uuid(),
  requestId: z.string().uuid().nullable().optional(),
  brandId: z.string().uuid(),
  title: z.string().trim().min(1).max(160),
  notes: z.string().trim().max(5000).nullable().optional(),
  taxRateBps: z.number().int().min(0).max(2000).optional(),
  lineItems: z.array(lineItemSchema).min(1).max(80),
});

async function insertLines(tx: Tx, quoteId: string, lines: LineInput[]) {
  await tx.delete(quoteLineItems).where(eq(quoteLineItems.quoteId, quoteId));
  await tx.insert(quoteLineItems).values(
    lines.map((line, index) => ({
      quoteId,
      position: index,
      kind: line.kind,
      description: line.description,
      quantity: line.quantity,
      unitAmountCents: line.unitAmountCents,
      taxable: line.taxable,
    })),
  );
}

export async function createQuote(actor: Actor, input: unknown) {
  assertOffice(actor);
  const data = parse(quoteWrite, input);
  const settings = await getCompanySettings();
  const taxRateBps = data.taxRateBps ?? settings.defaultTaxRateBps;
  priceLines(data.lineItems, taxRateBps);
  const id = await db.transaction(async (tx) => {
    const [customer] = await tx.select().from(customers).where(eq(customers.id, data.customerId));
    if (!customer) throw notFound("Customer not found.");
    await assertProperty(tx, data.customerId, data.propertyId);
    const [brand] = await tx.select().from(brands).where(eq(brands.id, data.brandId));
    if (!brand) throw new AppError(400, "Unknown brand.", "unknown_brand");
    if (data.requestId) {
      const [request] = await tx.select().from(requests).where(eq(requests.id, data.requestId));
      if (!request || request.customerId !== data.customerId) {
        throw new AppError(400, "That request is not for this customer.", "request_mismatch");
      }
    }
    const number = await nextNumber(tx, "quote");
    const [quote] = await tx
      .insert(quotes)
      .values({
        number,
        customerId: data.customerId,
        propertyId: data.propertyId,
        requestId: data.requestId ?? null,
        brandId: data.brandId,
        title: data.title,
        notes: data.notes ?? null,
        taxRateBps,
        status: "draft",
      })
      .returning();
    await insertLines(tx, quote.id, data.lineItems);
    if (data.requestId) {
      await tx
        .update(requests)
        .set({ status: "quoted", updatedAt: new Date() })
        .where(eq(requests.id, data.requestId));
    }
    return quote.id;
  });
  return loadQuote(id);
}

export async function updateQuote(actor: Actor, id: string, input: unknown) {
  assertOffice(actor);
  const data = parse(quoteWrite.partial(), input);
  const [existing] = await db.select().from(quotes).where(eq(quotes.id, id));
  if (!existing) throw notFound("Estimate not found.");
  if (existing.status !== "draft") throw new AppError(409, "Only a draft estimate can be edited.", "quote_locked");
  const taxRateBps = data.taxRateBps ?? existing.taxRateBps;
  if (data.lineItems) priceLines(data.lineItems, taxRateBps);
  await db.transaction(async (tx) => {
    if (data.customerId || data.propertyId) {
      await assertProperty(tx, data.customerId ?? existing.customerId, data.propertyId ?? existing.propertyId);
    }
    await tx
      .update(quotes)
      .set({
        customerId: data.customerId ?? existing.customerId,
        propertyId: data.propertyId ?? existing.propertyId,
        brandId: data.brandId ?? existing.brandId,
        title: data.title ?? existing.title,
        notes: data.notes === undefined ? existing.notes : data.notes,
        taxRateBps,
        updatedAt: new Date(),
      })
      .where(eq(quotes.id, id));
    if (data.lineItems) await insertLines(tx, id, data.lineItems);
  });
  return loadQuote(id);
}

export async function sendQuote(actor: Actor, id: string) {
  assertOffice(actor);
  const [existing] = await db.select().from(quotes).where(eq(quotes.id, id));
  if (!existing) throw notFound("Estimate not found.");
  if (existing.status !== "draft") throw new AppError(409, "Only a draft estimate can be sent.", "invalid_state");
  const validUntil = existing.validUntil ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await db
    .update(quotes)
    .set({
      status: "sent",
      sentAt: new Date(),
      validUntil,
      publicToken: existing.publicToken ?? newSecret("q_"),
      updatedAt: new Date(),
    })
    .where(eq(quotes.id, id));
  return loadQuote(id);
}

export async function approveQuote(actor: Actor, id: string, input: unknown) {
  assertOffice(actor);
  const data = parse(z.object({ approvedByName: z.string().trim().min(1).max(160) }), input);
  const approved = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(quotes).where(eq(quotes.id, id));
    if (!existing) throw notFound("Estimate not found.");
    if (existing.status !== "draft" && existing.status !== "sent") {
      throw new AppError(409, "This estimate can't be approved.", "invalid_state");
    }
    const loaded = await loadQuote(id);
    await tx
      .update(quotes)
      .set({
        status: "approved",
        approvedAt: new Date(),
        approvedByName: data.approvedByName,
        updatedAt: new Date(),
      })
      .where(eq(quotes.id, id));
    await emitEvent(tx, "quote.approved", {
      quoteId: existing.id,
      number: existing.number,
      customerId: existing.customerId,
      totalCents: loaded.data.totalCents,
    });
    return existing.id;
  });
  await safeDeliver();
  return loadQuote(approved);
}

export async function declineQuote(actor: Actor, id: string, input: unknown) {
  assertOffice(actor);
  const data = parse(z.object({ reason: z.string().trim().max(500).optional() }), input ?? {});
  const [existing] = await db.select().from(quotes).where(eq(quotes.id, id));
  if (!existing) throw notFound("Estimate not found.");
  if (existing.status !== "draft" && existing.status !== "sent") {
    throw new AppError(409, "This estimate can't be declined.", "invalid_state");
  }
  await db
    .update(quotes)
    .set({
      status: "declined",
      declinedAt: new Date(),
      declineReason: data.reason ?? null,
      updatedAt: new Date(),
    })
    .where(eq(quotes.id, id));
  return loadQuote(id);
}

export async function convertQuote(actor: Actor, id: string) {
  assertOffice(actor);
  const jobId = await db.transaction(async (tx) => {
    const [quote] = await tx.select().from(quotes).where(eq(quotes.id, id));
    if (!quote) throw notFound("Estimate not found.");
    if (quote.status !== "approved") throw new AppError(409, "Approve the estimate before opening a job.", "invalid_state");
    const [existingJob] = await tx.select().from(jobs).where(eq(jobs.quoteId, id));
    if (existingJob) throw new AppError(409, "This estimate is already a job.", "job_exists");
    const number = await nextNumber(tx, "job");
    const [job] = await tx
      .insert(jobs)
      .values({
        number,
        customerId: quote.customerId,
        propertyId: quote.propertyId,
        quoteId: quote.id,
        brandId: quote.brandId,
        title: quote.title,
        instructions: quote.notes,
        status: "unscheduled",
      })
      .returning();
    if (quote.requestId) {
      await tx.update(requests).set({ status: "closed", updatedAt: new Date() }).where(eq(requests.id, quote.requestId));
    }
    return job.id;
  });
  const { getJob } = await import("./work");
  return getJob(actor, jobId);
}

export async function getPublicQuote(token: string) {
  const [quote] = await db.select().from(quotes).where(eq(quotes.publicToken, token));
  if (!quote) throw notFound("Estimate not found.");
  const loaded = await loadQuote(quote.id);
  const settings = await getCompanySettings();
  const { publicToken: _hidden, ...rest } = loaded.data;
  return {
    data: {
      ...rest,
      company: settings.legalName,
      shopAddress: settings.shopAddress,
      expired: Boolean(quote.validUntil && quote.validUntil.getTime() < Date.now() && quote.status === "sent"),
    },
  };
}

export async function decidePublicQuote(token: string, input: unknown) {
  const data = parse(
    z.object({
      decision: z.enum(["approve", "decline"]),
      name: z.string().trim().min(1).max(160),
      reason: z.string().trim().max(500).optional(),
    }),
    input,
  );
  const [quote] = await db.select().from(quotes).where(eq(quotes.publicToken, token));
  if (!quote) throw notFound("Estimate not found.");
  if (quote.status !== "sent") throw new AppError(409, "This estimate is no longer waiting on a decision.", "invalid_state");
  if (quote.validUntil && quote.validUntil.getTime() < Date.now()) {
    throw new AppError(409, "This estimate is past its valid date. Call the office for a new one.", "quote_expired");
  }
  if (data.decision === "approve") {
    const loaded = await loadQuote(quote.id);
    await db.transaction(async (tx) => {
      await tx
        .update(quotes)
        .set({ status: "approved", approvedAt: new Date(), approvedByName: data.name, updatedAt: new Date() })
        .where(eq(quotes.id, quote.id));
      await emitEvent(tx, "quote.approved", {
        quoteId: quote.id,
        number: quote.number,
        customerId: quote.customerId,
        totalCents: loaded.data.totalCents,
        via: "customer_link",
      });
    });
    await safeDeliver();
  } else {
    await db
      .update(quotes)
      .set({
        status: "declined",
        declinedAt: new Date(),
        declineReason: data.reason ?? null,
        updatedAt: new Date(),
      })
      .where(eq(quotes.id, quote.id));
  }
  return getPublicQuote(token);
}
