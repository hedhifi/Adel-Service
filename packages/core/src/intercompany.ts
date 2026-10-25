import { lineAmountCents, summarizeMoney } from "@adel/db/money";
import {
  billLineItems,
  billPayments,
  bills,
  brands,
  customers,
  db,
  entities,
  entityLinks,
  intercompanyCharges,
  intercompanyRates,
  invoiceLineItems,
  invoices,
  jobs,
  payments,
  timeEntries,
  users,
  vendors,
  visits,
} from "@adel/db";
import { and, asc, desc, eq, inArray, ne, or } from "drizzle-orm";
import { z } from "zod";
import { nextNumber } from "./db";
import { AppError, notFound } from "./errors";
import { isUniqueViolation, parse } from "./parse";
import { assertOffice, type Actor } from "./permissions";
import { quickBooksStatusFor, syncEntity } from "./qbo/sync";
import { emitEvent, safeDeliver } from "./webhooks";

const quantitySchema = z.string().regex(/^\d+(\.\d{1,2})?$/, "Use a quantity like 1 or 2.50");

function assertPair(actor: Actor, supplyingEntityId: string, consumingEntityId: string) {
  if (supplyingEntityId === consumingEntityId) {
    throw new AppError(400, "A company cannot bill itself.", "invalid_input");
  }
  if (!actor.entityIds.includes(supplyingEntityId) || !actor.entityIds.includes(consumingEntityId)) {
    throw new AppError(403, "You have to belong to both companies to record a charge between them.", "forbidden");
  }
}

function presentRate(row: typeof intercompanyRates.$inferSelect, names: Map<string, string>) {
  return {
    id: row.id,
    supplyingEntityId: row.supplyingEntityId,
    consumingEntityId: row.consumingEntityId,
    supplierName: names.get(row.supplyingEntityId) ?? null,
    consumerName: names.get(row.consumingEntityId) ?? null,
    kind: row.kind,
    name: row.name,
    unit: row.unit,
    unitAmountCents: row.unitAmountCents,
    active: row.active,
  };
}

async function entityNames(ids: string[]) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map<string, string>();
  const rows = await db.select({ id: entities.id, name: entities.name }).from(entities).where(inArray(entities.id, unique));
  return new Map(rows.map((row) => [row.id, row.name]));
}

export async function listIntercompanyRates(actor: Actor) {
  assertOffice(actor);
  const rows = await db
    .select()
    .from(intercompanyRates)
    .where(or(eq(intercompanyRates.supplyingEntityId, actor.entityId), eq(intercompanyRates.consumingEntityId, actor.entityId)))
    .orderBy(asc(intercompanyRates.name));
  const names = await entityNames(rows.flatMap((row) => [row.supplyingEntityId, row.consumingEntityId]));
  return { data: rows.map((row) => presentRate(row, names)) };
}

export async function createIntercompanyRate(actor: Actor, input: unknown) {
  assertOffice(actor);
  const data = parse(
    z.object({
      supplyingEntityId: z.string().uuid(),
      consumingEntityId: z.string().uuid(),
      kind: z.enum(["labor", "material", "shared"]),
      name: z.string().trim().min(1).max(160),
      unit: z.string().trim().min(1).max(40),
      unitAmountCents: z.number().int().min(0).max(10_000_000),
    }),
    input,
  );
  assertPair(actor, data.supplyingEntityId, data.consumingEntityId);
  try {
    const [row] = await db.insert(intercompanyRates).values(data).returning();
    const names = await entityNames([row.supplyingEntityId, row.consumingEntityId]);
    return { data: presentRate(row, names) };
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError(409, "That rate name is already used for this pair of companies.", "conflict");
    throw err;
  }
}

export async function updateIntercompanyRate(actor: Actor, id: string, input: unknown) {
  assertOffice(actor);
  const data = parse(
    z.object({
      name: z.string().trim().min(1).max(160).optional(),
      unit: z.string().trim().min(1).max(40).optional(),
      unitAmountCents: z.number().int().min(0).max(10_000_000).optional(),
      active: z.boolean().optional(),
    }),
    input,
  );
  const [existing] = await db.select().from(intercompanyRates).where(eq(intercompanyRates.id, id));
  if (!existing) throw notFound("Rate not found.");
  assertPair(actor, existing.supplyingEntityId, existing.consumingEntityId);
  if (existing.supplyingEntityId !== actor.entityId && existing.consumingEntityId !== actor.entityId) {
    throw notFound("Rate not found.");
  }
  try {
    const [row] = await db
      .update(intercompanyRates)
      .set({
        name: data.name ?? existing.name,
        unit: data.unit ?? existing.unit,
        unitAmountCents: data.unitAmountCents ?? existing.unitAmountCents,
        active: data.active ?? existing.active,
        updatedAt: new Date(),
      })
      .where(eq(intercompanyRates.id, id))
      .returning();
    const names = await entityNames([row.supplyingEntityId, row.consumingEntityId]);
    return { data: presentRate(row, names) };
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError(409, "That rate name is already used for this pair of companies.", "conflict");
    throw err;
  }
}

function presentCharge(row: typeof intercompanyCharges.$inferSelect, names: Map<string, string>) {
  return {
    id: row.id,
    supplyingEntityId: row.supplyingEntityId,
    consumingEntityId: row.consumingEntityId,
    supplierName: names.get(row.supplyingEntityId) ?? null,
    consumerName: names.get(row.consumingEntityId) ?? null,
    rateId: row.rateId,
    kind: row.kind,
    description: row.description,
    quantity: row.quantity,
    unitAmountCents: row.unitAmountCents,
    amountCents: lineAmountCents(row.quantity, row.unitAmountCents),
    sourceVisitId: row.sourceVisitId,
    technicianUserId: row.technicianUserId,
    status: row.status,
    supplierInvoiceId: row.supplierInvoiceId,
    consumerBillId: row.consumerBillId,
    createdAt: row.createdAt,
  };
}

export async function listIntercompanyCharges(actor: Actor, query: { status?: string } = {}) {
  assertOffice(actor);
  const filters = [or(eq(intercompanyCharges.supplyingEntityId, actor.entityId), eq(intercompanyCharges.consumingEntityId, actor.entityId))];
  if (query.status) {
    const status = parse(z.enum(["open", "invoiced", "void"]), query.status);
    filters.push(eq(intercompanyCharges.status, status));
  }
  const rows = await db
    .select()
    .from(intercompanyCharges)
    .where(and(...filters))
    .orderBy(desc(intercompanyCharges.createdAt));
  const names = await entityNames(rows.flatMap((row) => [row.supplyingEntityId, row.consumingEntityId]));
  return { data: rows.map((row) => presentCharge(row, names)) };
}

async function rateForPair(id: string, supplyingEntityId: string, consumingEntityId: string) {
  const [rate] = await db.select().from(intercompanyRates).where(eq(intercompanyRates.id, id));
  if (!rate || !rate.active) throw notFound("Rate not found.");
  if (rate.supplyingEntityId !== supplyingEntityId || rate.consumingEntityId !== consumingEntityId) {
    throw new AppError(400, "That rate is for a different pair of companies.", "invalid_input");
  }
  return rate;
}

function lineKind(kind: "labor" | "material" | "shared"): "labor" | "material" | "other" {
  return kind === "shared" ? "other" : kind;
}

export async function createIntercompanyCharge(actor: Actor, input: unknown) {
  assertOffice(actor);
  const data = parse(
    z.object({
      supplyingEntityId: z.string().uuid(),
      consumingEntityId: z.string().uuid(),
      rateId: z.string().uuid(),
      quantity: quantitySchema,
      description: z.string().trim().min(1).max(500),
      unitAmountCents: z.number().int().min(0).max(10_000_000).optional(),
      sourceVisitId: z.string().uuid().optional(),
      technicianUserId: z.string().uuid().optional(),
    }),
    input,
  );
  assertPair(actor, data.supplyingEntityId, data.consumingEntityId);
  const rate = await rateForPair(data.rateId, data.supplyingEntityId, data.consumingEntityId);
  const unitAmountCents = data.unitAmountCents ?? rate.unitAmountCents;
  if (unitAmountCents <= 0) throw new AppError(400, "Enter the amount. This rate is a pass-through.", "invalid_input");
  lineAmountCents(data.quantity, unitAmountCents);
  const [row] = await db
    .insert(intercompanyCharges)
    .values({
      supplyingEntityId: data.supplyingEntityId,
      consumingEntityId: data.consumingEntityId,
      rateId: rate.id,
      kind: rate.kind,
      description: data.description,
      quantity: data.quantity,
      unitAmountCents,
      sourceVisitId: data.sourceVisitId ?? null,
      technicianUserId: data.technicianUserId ?? null,
    })
    .returning();
  await db.transaction(async (tx) => {
    await emitEvent(tx, "intercompany.charged", { chargeId: row.id, amountCents: lineAmountCents(row.quantity, row.unitAmountCents) }, data.supplyingEntityId);
    await emitEvent(tx, "intercompany.charged", { chargeId: row.id, amountCents: lineAmountCents(row.quantity, row.unitAmountCents) }, data.consumingEntityId);
  });
  await safeDeliver();
  const names = await entityNames([row.supplyingEntityId, row.consumingEntityId]);
  return { data: presentCharge(row, names) };
}

function hoursQuantity(ms: number) {
  const hundredths = Math.max(1, Math.round(ms / 36_000));
  const whole = Math.floor(hundredths / 100);
  const fraction = String(hundredths % 100).padStart(2, "0");
  return `${whole}.${fraction}`;
}

/**
 * Visits across the companies this person belongs to. Same read as the shared
 * dispatch board: the charge itself snapshots hours and does not keep a foreign key.
 */
export async function listIntercompanyVisits(actor: Actor) {
  assertOffice(actor);
  const rows = await db
    .select({
      id: visits.id,
      entityId: visits.entityId,
      entityName: entities.name,
      jobTitle: jobs.title,
      technicianId: visits.technicianId,
      technicianName: users.name,
      scheduledStart: visits.scheduledStart,
      scheduledEnd: visits.scheduledEnd,
      status: visits.status,
    })
    .from(visits)
    .innerJoin(jobs, eq(jobs.id, visits.jobId))
    .innerJoin(entities, eq(entities.id, visits.entityId))
    .leftJoin(users, eq(users.id, visits.technicianId))
    .where(and(inArray(visits.entityId, actor.entityIds), ne(visits.status, "canceled")))
    .orderBy(desc(visits.scheduledStart))
    .limit(40);
  const ids = rows.map((row) => row.id);
  const entries = ids.length === 0 ? [] : await db.select().from(timeEntries).where(inArray(timeEntries.visitId, ids));
  return {
    data: rows.map((row) => {
      const logged = entries.filter((entry) => entry.visitId === row.id && entry.endedAt);
      const ms = logged.reduce((sum, entry) => sum + (entry.endedAt!.getTime() - entry.startedAt.getTime()), 0);
      const fallback = row.scheduledEnd.getTime() - row.scheduledStart.getTime();
      const quantity = hoursQuantity(ms > 0 ? ms : Math.max(fallback, 0));
      return { ...row, quantity };
    }),
  };
}

export async function createChargeFromVisit(actor: Actor, input: unknown) {
  assertOffice(actor);
  const data = parse(
    z.object({
      visitId: z.string().uuid(),
      supplyingEntityId: z.string().uuid(),
      rateId: z.string().uuid(),
      unitAmountCents: z.number().int().min(0).max(10_000_000).optional(),
    }),
    input,
  );
  const [visit] = await db.select().from(visits).where(eq(visits.id, data.visitId));
  if (!visit || !actor.entityIds.includes(visit.entityId)) throw notFound("Visit not found.");
  const [job] = await db.select().from(jobs).where(eq(jobs.id, visit.jobId));
  if (!job) throw notFound("Visit not found.");
  const [tech] = visit.technicianId ? await db.select().from(users).where(eq(users.id, visit.technicianId)) : [undefined];
  const entries = await db.select().from(timeEntries).where(eq(timeEntries.visitId, visit.id));
  const logged = entries.filter((entry) => entry.endedAt);
  const ms = logged.reduce((sum, entry) => sum + (entry.endedAt!.getTime() - entry.startedAt.getTime()), 0);
  const fallback = visit.scheduledEnd.getTime() - visit.scheduledStart.getTime();
  if (ms <= 0 && fallback <= 0) throw new AppError(400, "This visit has no time to bill.", "invalid_input");
  const quantity = hoursQuantity(ms > 0 ? ms : fallback);
  const who = tech?.name ?? "A technician";
  return createIntercompanyCharge(actor, {
    supplyingEntityId: data.supplyingEntityId,
    consumingEntityId: visit.entityId,
    rateId: data.rateId,
    quantity,
    unitAmountCents: data.unitAmountCents,
    sourceVisitId: visit.id,
    technicianUserId: visit.technicianId ?? undefined,
    description: `${who} on ${job.title}`,
  });
}

export async function voidIntercompanyCharge(actor: Actor, id: string) {
  assertOffice(actor);
  const [row] = await db.select().from(intercompanyCharges).where(eq(intercompanyCharges.id, id));
  if (!row) throw notFound("Charge not found.");
  assertPair(actor, row.supplyingEntityId, row.consumingEntityId);
  if (row.supplyingEntityId !== actor.entityId && row.consumingEntityId !== actor.entityId) throw notFound("Charge not found.");
  if (row.status !== "open") throw new AppError(409, "Only an open charge can be voided.", "invalid_state");
  const [updated] = await db.update(intercompanyCharges).set({ status: "void" }).where(eq(intercompanyCharges.id, id)).returning();
  const names = await entityNames([updated.supplyingEntityId, updated.consumingEntityId]);
  return { data: presentCharge(updated, names) };
}

async function ensureCustomer(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], supplyingEntityId: string, consumingEntityId: string, consumingName: string) {
  const [link] = await tx
    .select()
    .from(entityLinks)
    .where(and(eq(entityLinks.kind, "intercompany_customer"), eq(entityLinks.fromEntityId, supplyingEntityId), eq(entityLinks.toEntityId, consumingEntityId)));
  if (link) {
    const [existing] = await tx.select().from(customers).where(and(eq(customers.id, link.fromRecordId), eq(customers.entityId, supplyingEntityId)));
    if (existing) return existing;
  }
  const [brand] = await tx.select().from(brands).where(eq(brands.entityId, supplyingEntityId)).limit(1);
  if (!brand) throw new AppError(400, "The supplying company has no brand.", "invalid_input");
  const [customer] = await tx
    .insert(customers)
    .values({
      entityId: supplyingEntityId,
      brandId: brand.id,
      name: consumingName,
      notes: "Intercompany customer. This is the other company, not a homeowner.",
    })
    .returning();
  await tx.insert(entityLinks).values({
    kind: "intercompany_customer",
    fromEntityId: supplyingEntityId,
    fromRecordId: customer.id,
    toEntityId: consumingEntityId,
    toRecordId: consumingEntityId,
  });
  return customer;
}

async function ensureVendor(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], consumingEntityId: string, supplyingEntityId: string, supplyingName: string) {
  const [link] = await tx
    .select()
    .from(entityLinks)
    .where(and(eq(entityLinks.kind, "intercompany_vendor"), eq(entityLinks.fromEntityId, consumingEntityId), eq(entityLinks.toEntityId, supplyingEntityId)));
  if (link) {
    const [existing] = await tx.select().from(vendors).where(and(eq(vendors.id, link.fromRecordId), eq(vendors.entityId, consumingEntityId)));
    if (existing) return existing;
  }
  const [vendor] = await tx
    .insert(vendors)
    .values({
      entityId: consumingEntityId,
      name: supplyingName,
      notes: "Intercompany vendor. This is the other company.",
    })
    .returning();
  await tx.insert(entityLinks).values({
    kind: "intercompany_vendor",
    fromEntityId: consumingEntityId,
    fromRecordId: vendor.id,
    toEntityId: supplyingEntityId,
    toRecordId: supplyingEntityId,
  });
  return vendor;
}

export async function generateIntercompanyInvoice(actor: Actor, input: unknown) {
  assertOffice(actor);
  const data = parse(
    z.object({
      supplyingEntityId: z.string().uuid(),
      consumingEntityId: z.string().uuid(),
      chargeIds: z.array(z.string().uuid()).optional(),
    }),
    input,
  );
  assertPair(actor, data.supplyingEntityId, data.consumingEntityId);
  const open = await db
    .select()
    .from(intercompanyCharges)
    .where(
      and(
        eq(intercompanyCharges.supplyingEntityId, data.supplyingEntityId),
        eq(intercompanyCharges.consumingEntityId, data.consumingEntityId),
        eq(intercompanyCharges.status, "open"),
      ),
    )
    .orderBy(asc(intercompanyCharges.createdAt));
  const chosen = data.chargeIds ? open.filter((row) => data.chargeIds?.includes(row.id)) : open;
  if (data.chargeIds && chosen.length !== data.chargeIds.length) {
    throw new AppError(400, "Every charge has to be open and between these two companies.", "invalid_input");
  }
  if (chosen.length === 0) throw new AppError(400, "There are no open charges to invoice.", "invalid_input");
  const names = await entityNames([data.supplyingEntityId, data.consumingEntityId]);
  const supplierName = names.get(data.supplyingEntityId) ?? "Supplying company";
  const consumerName = names.get(data.consumingEntityId) ?? "Consuming company";
  const lines = chosen.map((charge) => ({
    kind: lineKind(charge.kind),
    description: charge.description,
    quantity: charge.quantity,
    unitAmountCents: charge.unitAmountCents,
    taxable: false,
  }));
  const priced = summarizeMoney(lines, 0);
  const issuedAt = new Date();
  const dueAt = new Date(issuedAt.getTime() + 15 * 24 * 60 * 60 * 1000);
  const created = await db.transaction(async (tx) => {
    const customer = await ensureCustomer(tx, data.supplyingEntityId, data.consumingEntityId, consumerName);
    const vendor = await ensureVendor(tx, data.consumingEntityId, data.supplyingEntityId, supplierName);
    const [brand] = await tx.select().from(brands).where(eq(brands.entityId, data.supplyingEntityId)).limit(1);
    if (!brand) throw new AppError(400, "The supplying company has no brand.", "invalid_input");
    const invoiceNumber = await nextNumber(tx, data.supplyingEntityId, "invoice");
    const billNumber = await nextNumber(tx, data.consumingEntityId, "bill");
    const [invoice] = await tx
      .insert(invoices)
      .values({
        entityId: data.supplyingEntityId,
        number: invoiceNumber,
        customerId: customer.id,
        brandId: brand.id,
        status: "issued",
        taxRateBps: 0,
        issuedAt,
        dueAt,
        notes: `Intercompany charge to ${consumerName}. This invoice stays in ${supplierName}'s books.`,
      })
      .returning();
    await tx.insert(invoiceLineItems).values(
      lines.map((line, index) => ({ invoiceId: invoice.id, position: index, ...line })),
    );
    const [bill] = await tx
      .insert(bills)
      .values({
        entityId: data.consumingEntityId,
        number: billNumber,
        vendorId: vendor.id,
        status: "issued",
        taxRateBps: 0,
        issuedAt,
        dueAt,
        notes: `Intercompany charge from ${supplierName}. This bill stays in ${consumerName}'s books.`,
      })
      .returning();
    await tx.insert(billLineItems).values(lines.map((line, index) => ({ billId: bill.id, position: index, ...line })));
    await tx
      .update(intercompanyCharges)
      .set({ status: "invoiced", supplierInvoiceId: invoice.id, consumerBillId: bill.id })
      .where(inArray(intercompanyCharges.id, chosen.map((row) => row.id)));
    const [link] = await tx
      .insert(entityLinks)
      .values({
        kind: "intercompany_invoice",
        fromEntityId: data.supplyingEntityId,
        fromRecordId: invoice.id,
        toEntityId: data.consumingEntityId,
        toRecordId: bill.id,
      })
      .returning();
    const payload = {
      linkId: link.id,
      invoiceId: invoice.id,
      billId: bill.id,
      totalCents: priced.totalCents,
      supplyingEntityId: data.supplyingEntityId,
      consumingEntityId: data.consumingEntityId,
    };
    await emitEvent(tx, "intercompany.invoiced", payload, data.supplyingEntityId);
    await emitEvent(tx, "intercompany.invoiced", payload, data.consumingEntityId);
    await emitEvent(tx, "invoice.issued", { invoiceId: invoice.id, number: invoice.number, customerId: customer.id, totalCents: priced.totalCents }, data.supplyingEntityId);
    return { invoiceId: invoice.id, invoiceNumber: invoice.number, billId: bill.id, billNumber: bill.number, totalCents: priced.totalCents, linkId: link.id };
  });
  await safeDeliver();
  await syncEntity(data.supplyingEntityId, { force: true }).catch((err) => console.error("quickbooks sync failed", err));
  await syncEntity(data.consumingEntityId, { force: true }).catch((err) => console.error("quickbooks sync failed", err));
  return { data: created };
}

async function documentBalance(kind: "invoice" | "bill", id: string) {
  if (kind === "invoice") {
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id));
    if (!invoice) return null;
    const lines = await db.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, id));
    const summary = summarizeMoney(lines, invoice.taxRateBps);
    const pays = await db.select().from(payments).where(eq(payments.invoiceId, id));
    const paid = pays.filter((row) => row.status === "succeeded").reduce((sum, row) => sum + row.amountCents, 0);
    return { id: invoice.id, number: invoice.number, status: invoice.status, entityId: invoice.entityId, totalCents: summary.totalCents, balanceCents: invoice.status === "void" ? 0 : summary.totalCents - paid };
  }
  const [bill] = await db.select().from(bills).where(eq(bills.id, id));
  if (!bill) return null;
  const lines = await db.select().from(billLineItems).where(eq(billLineItems.billId, id));
  const summary = summarizeMoney(lines, bill.taxRateBps);
  const pays = await db.select().from(billPayments).where(eq(billPayments.billId, id));
  const paid = pays.filter((row) => row.status === "succeeded").reduce((sum, row) => sum + row.amountCents, 0);
  return { id: bill.id, number: bill.number, status: bill.status, entityId: bill.entityId, totalCents: summary.totalCents, balanceCents: bill.status === "void" ? 0 : summary.totalCents - paid };
}

export async function settleIntercompany(actor: Actor, input: unknown) {
  assertOffice(actor);
  const data = parse(
    z.object({
      linkId: z.string().uuid(),
      amountCents: z.number().int().positive(),
      reference: z.string().trim().max(80).optional(),
    }),
    input,
  );
  const [link] = await db.select().from(entityLinks).where(and(eq(entityLinks.id, data.linkId), eq(entityLinks.kind, "intercompany_invoice")));
  if (!link) throw notFound("That intercompany invoice was not found.");
  assertPair(actor, link.fromEntityId, link.toEntityId);
  const invoice = await documentBalance("invoice", link.fromRecordId);
  const bill = await documentBalance("bill", link.toRecordId);
  if (!invoice || invoice.entityId !== link.fromEntityId || !bill || bill.entityId !== link.toEntityId) {
    throw notFound("That intercompany invoice was not found.");
  }
  if (invoice.status === "void" || bill.status === "void") throw new AppError(409, "A voided intercompany invoice cannot be settled.", "invalid_state");
  if (data.amountCents > invoice.balanceCents || data.amountCents > bill.balanceCents) {
    throw new AppError(400, "That amount is more than the open balance.", "amount_too_high");
  }
  const receivedAt = new Date();
  await db.transaction(async (tx) => {
    const [payment] = await tx
      .insert(payments)
      .values({
        invoiceId: invoice.id,
        amountCents: data.amountCents,
        status: "succeeded",
        method: "other",
        reference: data.reference ?? "Intercompany settlement",
        recordedById: actor.id,
        receivedAt,
      })
      .returning();
    const [billPayment] = await tx
      .insert(billPayments)
      .values({
        billId: bill.id,
        amountCents: data.amountCents,
        status: "succeeded",
        method: "other",
        reference: data.reference ?? "Intercompany settlement",
        recordedById: actor.id,
        receivedAt,
      })
      .returning();
    const invoiceLines = await tx.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, invoice.id));
    const invoiceSummary = summarizeMoney(invoiceLines, 0);
    const invoicePays = await tx.select().from(payments).where(eq(payments.invoiceId, invoice.id));
    const invoicePaid = invoicePays.filter((row) => row.status === "succeeded").reduce((sum, row) => sum + row.amountCents, 0);
    const invoiceStatus = invoicePaid <= 0 ? "issued" : invoicePaid < invoiceSummary.totalCents ? "partial" : "paid";
    await tx.update(invoices).set({ status: invoiceStatus, updatedAt: new Date() }).where(eq(invoices.id, invoice.id));
    const billLines = await tx.select().from(billLineItems).where(eq(billLineItems.billId, bill.id));
    const billSummary = summarizeMoney(billLines, 0);
    const billPays = await tx.select().from(billPayments).where(eq(billPayments.billId, bill.id));
    const billPaid = billPays.filter((row) => row.status === "succeeded").reduce((sum, row) => sum + row.amountCents, 0);
    const billStatus = billPaid <= 0 ? "issued" : billPaid < billSummary.totalCents ? "partial" : "paid";
    await tx.update(bills).set({ status: billStatus, updatedAt: new Date() }).where(eq(bills.id, bill.id));
    const payload = { linkId: link.id, invoiceId: invoice.id, billId: bill.id, paymentId: payment.id, billPaymentId: billPayment.id, amountCents: data.amountCents };
    await emitEvent(tx, "intercompany.settled", payload, link.fromEntityId);
    await emitEvent(tx, "intercompany.settled", payload, link.toEntityId);
    await emitEvent(tx, "payment.received", { paymentId: payment.id, invoiceId: invoice.id, amountCents: data.amountCents, method: "other" }, link.fromEntityId);
  });
  await safeDeliver();
  await syncEntity(link.fromEntityId, { force: true }).catch((err) => console.error("quickbooks sync failed", err));
  await syncEntity(link.toEntityId, { force: true }).catch((err) => console.error("quickbooks sync failed", err));
  return getReconciliation(actor);
}

/**
 * Reconciliation starts from the link layer. Each company's invoice or bill is
 * loaded only when this person belongs to that company.
 */
export async function getReconciliation(actor: Actor) {
  assertOffice(actor);
  const names = await entityNames(actor.entityIds);
  const charges = await db
    .select()
    .from(intercompanyCharges)
    .where(or(eq(intercompanyCharges.supplyingEntityId, actor.entityId), eq(intercompanyCharges.consumingEntityId, actor.entityId)))
    .orderBy(desc(intercompanyCharges.createdAt));
  const links = await db
    .select()
    .from(entityLinks)
    .where(and(eq(entityLinks.kind, "intercompany_invoice"), or(eq(entityLinks.fromEntityId, actor.entityId), eq(entityLinks.toEntityId, actor.entityId))));
  let receivableCents = 0;
  let payableCents = 0;
  const pairs = [];
  for (const link of links) {
    const invoice = actor.entityIds.includes(link.fromEntityId) ? await documentBalance("invoice", link.fromRecordId) : null;
    const bill = actor.entityIds.includes(link.toEntityId) ? await documentBalance("bill", link.toRecordId) : null;
    if (invoice && invoice.entityId === actor.entityId) receivableCents += invoice.balanceCents;
    if (bill && bill.entityId === actor.entityId) payableCents += bill.balanceCents;
    const invoiceQbo = invoice ? await quickBooksStatusFor(invoice.entityId, "invoice", invoice.id) : null;
    const billQbo = bill ? await quickBooksStatusFor(bill.entityId, "bill", bill.id) : null;
    const related = charges.filter((charge) => charge.supplierInvoiceId === link.fromRecordId);
    pairs.push({
      linkId: link.id,
      supplyingEntityId: link.fromEntityId,
      consumingEntityId: link.toEntityId,
      supplierName: names.get(link.fromEntityId) ?? null,
      consumerName: names.get(link.toEntityId) ?? null,
      invoice: invoice ? { ...invoice, qboStatus: invoiceQbo } : { recordId: link.fromRecordId },
      bill: bill ? { ...bill, qboStatus: billQbo } : { recordId: link.toRecordId },
      chargeIds: related.map((charge) => charge.id),
      inBalance: Boolean(invoice && bill && invoice.totalCents === bill.totalCents),
      bothPosted: invoiceQbo === "synced" && billQbo === "synced",
    });
  }
  return {
    data: {
      entityId: actor.entityId,
      companyName: names.get(actor.entityId) ?? null,
      receivableCents,
      payableCents,
      netCents: receivableCents - payableCents,
      openCharges: charges.filter((row) => row.status === "open").map((row) => presentCharge(row, names)),
      pairs,
    },
  };
}
