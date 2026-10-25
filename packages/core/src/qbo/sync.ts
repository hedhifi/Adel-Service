import { createHash } from "node:crypto";
import { summarizeMoney } from "@adel/db/money";
import {
  billLineItems,
  billPayments,
  bills,
  brands,
  catalogItems,
  customers,
  db,
  entities,
  invoiceLineItems,
  invoices,
  payments,
  qboConnections,
  qboMappings,
  qboSyncLog,
  qboSyncState,
  vendors,
} from "@adel/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { assertQuickBooksPlugin, quickBooksPluginEnabled } from "../accounting/provider";
import { AppError, notFound } from "../errors";
import { assertOffice, type Actor } from "../permissions";
import { emitEvent, safeDeliver } from "../webhooks";
import {
  IntuitSandboxProvider,
  MockSandboxProvider,
  QboSandboxError,
  QboStaleError,
  assertNotProductionEnv,
  assertSandboxBase,
  exchangeSandboxCode,
  intuitSandboxConfigured,
  readOAuthState,
  sandboxAuthorizeUrl,
  stripQbo,
  type QboObject,
  type QboProvider,
  type QboType,
} from "./sandbox";

type QboResource = "customer" | "item" | "invoice" | "payment" | "vendor" | "bill" | "bill_payment";
type Outcome = "pushed" | "pulled" | "skipped" | "conflict" | "failed";
type Mapping = typeof qboMappings.$inferSelect;
type Connection = typeof qboConnections.$inferSelect;

const QBO_TYPE: Record<QboResource, QboType> = {
  customer: "Customer",
  item: "Item",
  invoice: "Invoice",
  payment: "Payment",
  vendor: "Vendor",
  bill: "Bill",
  bill_payment: "BillPayment",
};

const PULLABLE = new Set<QboResource>(["customer", "item", "vendor"]);

export type SyncSummary = {
  connected: boolean;
  realmId: string | null;
  provider: "mock" | "intuit" | null;
  pushed: number;
  pulled: number;
  skipped: number;
  conflicts: number;
  failed: number;
  remoteCreated: number;
};

function emptySummary(): SyncSummary {
  return { connected: false, realmId: null, provider: null, pushed: 0, pulled: 0, skipped: 0, conflicts: 0, failed: 0, remoteCreated: 0 };
}

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable(obj[key])}`)
    .join(",")}}`;
}

export function hashJson(value: unknown) {
  return createHash("sha256").update(stable(value)).digest("hex");
}

function dollars(cents: number) {
  return cents / 100;
}

function centsFromDollars(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value * 100) : null;
}

function publicConnection(row: Connection) {
  return {
    id: row.id,
    entityId: row.entityId,
    environment: row.environment,
    provider: row.provider,
    realmId: row.realmId,
    companyName: row.companyName,
    connectedAt: row.connectedAt,
    updatedAt: row.updatedAt,
  };
}

async function providerFor(connection: Connection): Promise<QboProvider> {
  if (connection.provider === "mock") return new MockSandboxProvider();
  if (!connection.accessToken) {
    throw new AppError(400, "Reconnect the Intuit sandbox. The access token is missing.", "qbo_not_configured");
  }
  if (process.env.QBO_API_BASE) assertSandboxBase(process.env.QBO_API_BASE);
  return new IntuitSandboxProvider(connection.accessToken);
}

type Ctx = {
  entityId: string;
  realmId: string;
  provider: QboProvider;
  summary: SyncSummary;
  force: boolean;
};

async function mappingFor(entityId: string, resourceType: QboResource, resourceId: string) {
  const [row] = await db
    .select()
    .from(qboMappings)
    .where(and(eq(qboMappings.entityId, entityId), eq(qboMappings.resourceType, resourceType), eq(qboMappings.resourceId, resourceId)));
  return row ?? null;
}

async function stateFor(entityId: string, resourceType: QboResource, resourceId: string) {
  const [row] = await db
    .select()
    .from(qboSyncState)
    .where(and(eq(qboSyncState.entityId, entityId), eq(qboSyncState.resourceType, resourceType), eq(qboSyncState.resourceId, resourceId)));
  return row ?? null;
}

async function saveMapping(entityId: string, resourceType: QboResource, resourceId: string, realmId: string, remote: QboObject, localHash: string) {
  const values = {
    entityId,
    resourceType,
    resourceId,
    realmId,
    qboId: remote.Id,
    syncToken: remote.SyncToken,
    localHash,
    remoteHash: hashJson(stripQbo(remote)),
    lastSyncedAt: new Date(),
  };
  await db
    .insert(qboMappings)
    .values(values)
    .onConflictDoUpdate({
      target: [qboMappings.entityId, qboMappings.resourceType, qboMappings.resourceId],
      set: values,
    });
}

async function putState(entityId: string, resourceType: QboResource, resourceId: string, status: "synced" | "failed" | "conflict", attemptCount: number, lastError: string | null, nextRetryAt: Date | null) {
  await db
    .insert(qboSyncState)
    .values({ entityId, resourceType, resourceId, status, attemptCount, lastError, nextRetryAt, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [qboSyncState.entityId, qboSyncState.resourceType, qboSyncState.resourceId],
      set: { status, attemptCount, lastError, nextRetryAt, updatedAt: new Date() },
    });
}

async function logSync(entityId: string, resourceType: QboResource, resourceId: string, direction: string, status: "synced" | "failed" | "conflict", attemptCount: number, message: string) {
  await db.insert(qboSyncLog).values({ entityId, resourceType, resourceId, direction, status, attemptCount, message });
}

function backoff(attempt: number) {
  const seconds = Math.min(3600, 2 ** Math.min(attempt, 8));
  return new Date(Date.now() + seconds * 1000);
}

async function syncResource(
  ctx: Ctx,
  input: {
    resourceType: QboResource;
    resourceId: string;
    label: string;
    localHash: string;
    payload: Record<string, unknown>;
    localTotalCents?: number;
    onPull?: (remote: QboObject) => Promise<string>;
    overwrite?: boolean;
    preferRemote?: boolean;
  },
): Promise<Outcome> {
  const state = await stateFor(ctx.entityId, input.resourceType, input.resourceId);
  if (!input.overwrite && !input.preferRemote && state?.status === "conflict") {
    ctx.summary.conflicts += 1;
    return "conflict";
  }
  if (!input.overwrite && !input.preferRemote && state?.status === "failed" && !ctx.force) {
    if (state.attemptCount >= 5 || (state.nextRetryAt && state.nextRetryAt > new Date())) {
      ctx.summary.skipped += 1;
      return "skipped";
    }
  }
  const attempt = state?.attemptCount ?? 0;
  try {
    const mapping = await mappingFor(ctx.entityId, input.resourceType, input.resourceId);
    const qboType = QBO_TYPE[input.resourceType];
    const remote = mapping ? await ctx.provider.get(ctx.realmId, qboType, mapping.qboId) : null;
    const remoteDirty = Boolean(mapping && remote && remote.SyncToken !== mapping.syncToken);
    const localDirty = !mapping || input.localHash !== mapping.localHash;
    const pullable = PULLABLE.has(input.resourceType);

    if (input.preferRemote) {
      if (!remote || !input.onPull) throw new QboSandboxError(`QuickBooks no longer has ${input.label}.`);
      const pulledHash = await input.onPull(remote);
      await saveMapping(ctx.entityId, input.resourceType, input.resourceId, ctx.realmId, remote, pulledHash);
      await putState(ctx.entityId, input.resourceType, input.resourceId, "synced", 0, null, null);
      await logSync(ctx.entityId, input.resourceType, input.resourceId, "pull", "synced", attempt, `Kept the QuickBooks version of ${input.label}.`);
      ctx.summary.pulled += 1;
      return "pulled";
    }

    if (mapping && remote && remoteDirty && localDirty && !input.overwrite) {
      if (state?.status !== "conflict") {
        await logSync(ctx.entityId, input.resourceType, input.resourceId, "push", "conflict", attempt, `Conflict on ${input.label}. It changed in both places.`);
      }
      await putState(ctx.entityId, input.resourceType, input.resourceId, "conflict", attempt, `Conflict on ${input.label}.`, null);
      ctx.summary.conflicts += 1;
      return "conflict";
    }

    if (mapping && remote && remoteDirty && !localDirty && !input.overwrite) {
      if (pullable && input.onPull) {
        const pulledHash = await input.onPull(remote);
        await saveMapping(ctx.entityId, input.resourceType, input.resourceId, ctx.realmId, remote, pulledHash);
        await putState(ctx.entityId, input.resourceType, input.resourceId, "synced", 0, null, null);
        await logSync(ctx.entityId, input.resourceType, input.resourceId, "pull", "synced", attempt, `Pulled ${input.label} from QuickBooks.`);
        ctx.summary.pulled += 1;
        return "pulled";
      }
      const remoteCents = centsFromDollars(remote.TotalAmt);
      if (input.localTotalCents != null && remoteCents === input.localTotalCents) {
        await saveMapping(ctx.entityId, input.resourceType, input.resourceId, ctx.realmId, remote, input.localHash);
        await putState(ctx.entityId, input.resourceType, input.resourceId, "synced", 0, null, null);
        ctx.summary.skipped += 1;
        return "skipped";
      }
      if (state?.status !== "conflict") {
        await logSync(ctx.entityId, input.resourceType, input.resourceId, "pull", "conflict", attempt, `Conflict on ${input.label}. QuickBooks has a different amount.`);
      }
      await putState(ctx.entityId, input.resourceType, input.resourceId, "conflict", attempt, `Conflict on ${input.label}.`, null);
      ctx.summary.conflicts += 1;
      return "conflict";
    }

    if (!localDirty && !input.overwrite) {
      ctx.summary.skipped += 1;
      return "skipped";
    }

    const existing = remote ? { Id: remote.Id, SyncToken: remote.SyncToken } : mapping && !remote ? undefined : mapping ? { Id: mapping.qboId, SyncToken: mapping.syncToken } : undefined;
    const saved = await ctx.provider.upsert(ctx.realmId, qboType, input.payload, existing);
    await saveMapping(ctx.entityId, input.resourceType, input.resourceId, ctx.realmId, saved, input.localHash);
    await putState(ctx.entityId, input.resourceType, input.resourceId, "synced", 0, null, null);
    await logSync(ctx.entityId, input.resourceType, input.resourceId, "push", "synced", attempt, `Pushed ${input.label} to QuickBooks.`);
    ctx.summary.pushed += 1;
    return "pushed";
  } catch (err) {
    if (err instanceof QboStaleError) {
      await logSync(ctx.entityId, input.resourceType, input.resourceId, "push", "conflict", attempt, `Conflict on ${input.label}. QuickBooks has a newer version.`);
      await putState(ctx.entityId, input.resourceType, input.resourceId, "conflict", attempt, err.message, null);
      ctx.summary.conflicts += 1;
      return "conflict";
    }
    const message = err instanceof Error ? err.message : "QuickBooks sync failed.";
    const nextAttempt = attempt + 1;
    await logSync(ctx.entityId, input.resourceType, input.resourceId, "push", "failed", nextAttempt, `${input.label} failed: ${message}`);
    await putState(ctx.entityId, input.resourceType, input.resourceId, "failed", nextAttempt, message, backoff(nextAttempt));
    ctx.summary.failed += 1;
    return "failed";
  }
}

function customerLocal(row: { name: string; email: string | null; phone: string | null; notes: string | null }) {
  return { name: row.name, email: row.email, phone: row.phone, notes: row.notes };
}

function customerPayload(row: { name: string; email: string | null; phone: string | null; notes: string | null }) {
  return {
    DisplayName: row.name,
    PrimaryEmailAddr: row.email ? { Address: row.email } : null,
    PrimaryPhone: row.phone ? { FreeFormNumber: row.phone } : null,
    Notes: row.notes,
  };
}

async function syncCustomer(ctx: Ctx, row: typeof customers.$inferSelect, options: { overwrite?: boolean; preferRemote?: boolean } = {}) {
  return syncResource(ctx, {
    resourceType: "customer",
    resourceId: row.id,
    label: `customer ${row.name}`,
    localHash: hashJson(customerLocal(row)),
    payload: customerPayload(row),
    overwrite: options.overwrite,
    preferRemote: options.preferRemote,
    onPull: async (remote) => {
      const name = String(remote.DisplayName ?? "").trim();
      if (!name) throw new QboSandboxError("QuickBooks customer has no name.");
      const emailObj = remote.PrimaryEmailAddr as { Address?: string } | null;
      const phoneObj = remote.PrimaryPhone as { FreeFormNumber?: string } | null;
      const next = {
        name,
        email: emailObj?.Address ?? null,
        phone: phoneObj?.FreeFormNumber ?? null,
        notes: typeof remote.Notes === "string" ? remote.Notes : null,
      };
      await db.update(customers).set({ ...next, updatedAt: new Date() }).where(eq(customers.id, row.id));
      return hashJson(next);
    },
  });
}

function itemLocal(row: typeof catalogItems.$inferSelect) {
  return {
    name: row.name,
    description: row.description,
    kind: row.kind,
    sku: row.sku,
    unitAmountCents: row.unitAmountCents,
    taxable: row.taxable,
    active: row.active,
  };
}

function itemPayload(row: typeof catalogItems.$inferSelect) {
  return {
    Name: row.name,
    Description: row.description,
    Type: row.kind === "labor" ? "Service" : "NonInventory",
    Sku: row.sku,
    UnitPrice: dollars(row.unitAmountCents),
    Taxable: row.taxable,
    Active: row.active,
  };
}

async function syncItem(ctx: Ctx, row: typeof catalogItems.$inferSelect, options: { overwrite?: boolean; preferRemote?: boolean } = {}) {
  return syncResource(ctx, {
    resourceType: "item",
    resourceId: row.id,
    label: `item ${row.name}`,
    localHash: hashJson(itemLocal(row)),
    payload: itemPayload(row),
    overwrite: options.overwrite,
    preferRemote: options.preferRemote,
    onPull: async (remote) => {
      const name = String(remote.Name ?? "").trim();
      if (!name) throw new QboSandboxError("QuickBooks item has no name.");
      const unit = centsFromDollars(remote.UnitPrice);
      const kind = remote.Type === "Service" ? "labor" : remote.Type === "NonInventory" ? "material" : row.kind;
      const next = {
        name,
        description: typeof remote.Description === "string" ? remote.Description : null,
        kind,
        sku: typeof remote.Sku === "string" ? remote.Sku : null,
        unitAmountCents: unit ?? row.unitAmountCents,
        taxable: typeof remote.Taxable === "boolean" ? remote.Taxable : row.taxable,
        active: typeof remote.Active === "boolean" ? remote.Active : row.active,
      };
      await db.update(catalogItems).set({ ...next, updatedAt: new Date() }).where(eq(catalogItems.id, row.id));
      return hashJson(next);
    },
  });
}

function vendorLocal(row: { name: string; notes: string | null }) {
  return { name: row.name, notes: row.notes };
}

async function syncVendor(ctx: Ctx, row: typeof vendors.$inferSelect, options: { overwrite?: boolean; preferRemote?: boolean } = {}) {
  return syncResource(ctx, {
    resourceType: "vendor",
    resourceId: row.id,
    label: `vendor ${row.name}`,
    localHash: hashJson(vendorLocal(row)),
    payload: { DisplayName: row.name, Notes: row.notes },
    overwrite: options.overwrite,
    preferRemote: options.preferRemote,
    onPull: async (remote) => {
      const name = String(remote.DisplayName ?? "").trim();
      if (!name) throw new QboSandboxError("QuickBooks vendor has no name.");
      const next = { name, notes: typeof remote.Notes === "string" ? remote.Notes : null };
      await db.update(vendors).set({ ...next, updatedAt: new Date() }).where(eq(vendors.id, row.id));
      return hashJson(next);
    },
  });
}

async function requireMapped(ctx: Ctx, resourceType: QboResource, resourceId: string, label: string) {
  const mapping = await mappingFor(ctx.entityId, resourceType, resourceId);
  if (!mapping || mapping.realmId !== ctx.realmId) throw new QboSandboxError(`${label} is not in this QuickBooks company yet.`);
  return mapping.qboId;
}

async function kindItem(ctx: Ctx, kind: "labor" | "material" | "other") {
  const name = kind === "labor" ? "Labor" : kind === "material" ? "Materials" : "Other";
  const [existing] = await db
    .select()
    .from(catalogItems)
    .where(and(eq(catalogItems.entityId, ctx.entityId), eq(catalogItems.name, name)));
  const row =
    existing ??
    (
      await db
        .insert(catalogItems)
        .values({
          entityId: ctx.entityId,
          name,
          kind,
          unitAmountCents: 0,
          taxable: kind === "material",
          description: "Used when an invoice line has no catalog item.",
        })
        .returning()
    )[0];
  const outcome = await syncItem(ctx, row);
  if (outcome === "failed" || outcome === "conflict") throw new QboSandboxError(`${name} did not sync.`);
  return requireMapped(ctx, "item", row.id, name);
}

async function syncInvoice(ctx: Ctx, invoice: typeof invoices.$inferSelect, overwrite = false) {
  if (invoice.status === "draft") {
    ctx.summary.skipped += 1;
    return "skipped" as const;
  }
  if (invoice.status === "void") {
    const mapping = await mappingFor(ctx.entityId, "invoice", invoice.id);
    if (!mapping) {
      ctx.summary.skipped += 1;
      return "skipped" as const;
    }
  }
  const [customer] = await db.select().from(customers).where(eq(customers.id, invoice.customerId));
  if (!customer) throw new QboSandboxError("Invoice customer is missing.");
  const customerOutcome = await syncCustomer(ctx, customer);
  if (customerOutcome === "failed" || customerOutcome === "conflict") throw new QboSandboxError(`Customer ${customer.name} did not sync.`);
  const customerQboId = await requireMapped(ctx, "customer", customer.id, customer.name);
  const lines = await db.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, invoice.id)).orderBy(invoiceLineItems.position);
  const summary = summarizeMoney(lines, invoice.taxRateBps);
  const payRows = await db.select().from(payments).where(eq(payments.invoiceId, invoice.id));
  const paidCents = payRows.filter((row) => row.status === "succeeded").reduce((sum, row) => sum + row.amountCents, 0);
  const balanceCents = invoice.status === "void" ? 0 : summary.totalCents - paidCents;
  const priced = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const itemId = await kindItem(ctx, line.kind);
    priced.push({
      Description: line.description,
      Amount: dollars(summary.lines[index]?.amountCents ?? 0),
      DetailType: "SalesItemLineDetail",
      SalesItemLineDetail: {
        ItemRef: { value: itemId },
        Qty: Number(line.quantity),
        UnitPrice: dollars(line.unitAmountCents),
      },
    });
  }
  const local = {
    number: invoice.number,
    customerId: invoice.customerId,
    status: invoice.status,
    notes: invoice.notes,
    totalCents: summary.totalCents,
    balanceCents,
    lines: lines.map((line) => ({
      kind: line.kind,
      description: line.description,
      quantity: line.quantity,
      unitAmountCents: line.unitAmountCents,
      taxable: line.taxable,
    })),
  };
  return syncResource(ctx, {
    resourceType: "invoice",
    resourceId: invoice.id,
    label: `invoice ${invoice.number}`,
    localHash: hashJson(local),
    localTotalCents: summary.totalCents,
    overwrite,
    payload: {
      DocNumber: String(invoice.number),
      CustomerRef: { value: customerQboId },
      TxnDate: (invoice.issuedAt ?? invoice.createdAt).toISOString().slice(0, 10),
      DueDate: invoice.dueAt ? invoice.dueAt.toISOString().slice(0, 10) : null,
      PrivateNote: invoice.notes,
      AdelStatus: invoice.status,
      Line: priced,
      TotalAmt: dollars(summary.totalCents),
      Balance: dollars(balanceCents),
    },
  });
}

async function syncPayment(ctx: Ctx, payment: typeof payments.$inferSelect, invoice: typeof invoices.$inferSelect, overwrite = false) {
  if (payment.status !== "succeeded") {
    ctx.summary.skipped += 1;
    return "skipped" as const;
  }
  const invoiceOutcome = await syncInvoice(ctx, invoice);
  if (invoiceOutcome === "failed" || invoiceOutcome === "conflict") throw new QboSandboxError(`Invoice ${invoice.number} did not sync.`);
  const invoiceQboId = await requireMapped(ctx, "invoice", invoice.id, `invoice ${invoice.number}`);
  const customerQboId = await requireMapped(ctx, "customer", invoice.customerId, "customer");
  const local = { amountCents: payment.amountCents, status: payment.status, method: payment.method, reference: payment.reference, invoiceId: payment.invoiceId };
  return syncResource(ctx, {
    resourceType: "payment",
    resourceId: payment.id,
    label: `payment ${payment.amountCents}`,
    localHash: hashJson(local),
    localTotalCents: payment.amountCents,
    overwrite,
    payload: {
      TotalAmt: dollars(payment.amountCents),
      CustomerRef: { value: customerQboId },
      PaymentRefNum: payment.reference,
      PrivateNote: payment.method,
      Line: [{ Amount: dollars(payment.amountCents), LinkedTxn: [{ TxnId: invoiceQboId, TxnType: "Invoice" }] }],
    },
  });
}

async function syncBill(ctx: Ctx, bill: typeof bills.$inferSelect, overwrite = false) {
  if (bill.status === "draft") {
    ctx.summary.skipped += 1;
    return "skipped" as const;
  }
  if (bill.status === "void") {
    const mapping = await mappingFor(ctx.entityId, "bill", bill.id);
    if (!mapping) {
      ctx.summary.skipped += 1;
      return "skipped" as const;
    }
  }
  const [vendor] = await db.select().from(vendors).where(eq(vendors.id, bill.vendorId));
  if (!vendor) throw new QboSandboxError("Bill vendor is missing.");
  const vendorOutcome = await syncVendor(ctx, vendor);
  if (vendorOutcome === "failed" || vendorOutcome === "conflict") throw new QboSandboxError(`Vendor ${vendor.name} did not sync.`);
  const vendorQboId = await requireMapped(ctx, "vendor", vendor.id, vendor.name);
  const lines = await db.select().from(billLineItems).where(eq(billLineItems.billId, bill.id)).orderBy(billLineItems.position);
  const summary = summarizeMoney(lines, bill.taxRateBps);
  const payRows = await db.select().from(billPayments).where(eq(billPayments.billId, bill.id));
  const paidCents = payRows.filter((row) => row.status === "succeeded").reduce((sum, row) => sum + row.amountCents, 0);
  const balanceCents = bill.status === "void" ? 0 : summary.totalCents - paidCents;
  const priced = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const itemId = await kindItem(ctx, line.kind);
    priced.push({
      Description: line.description,
      Amount: dollars(summary.lines[index]?.amountCents ?? 0),
      DetailType: "ItemBasedExpenseLineDetail",
      ItemBasedExpenseLineDetail: { ItemRef: { value: itemId }, Qty: Number(line.quantity), UnitPrice: dollars(line.unitAmountCents) },
    });
  }
  const local = {
    number: bill.number,
    vendorId: bill.vendorId,
    status: bill.status,
    notes: bill.notes,
    totalCents: summary.totalCents,
    balanceCents,
    lines: lines.map((line) => ({
      kind: line.kind,
      description: line.description,
      quantity: line.quantity,
      unitAmountCents: line.unitAmountCents,
    })),
  };
  return syncResource(ctx, {
    resourceType: "bill",
    resourceId: bill.id,
    label: `bill ${bill.number}`,
    localHash: hashJson(local),
    localTotalCents: summary.totalCents,
    overwrite,
    payload: {
      DocNumber: String(bill.number),
      VendorRef: { value: vendorQboId },
      TxnDate: (bill.issuedAt ?? bill.createdAt).toISOString().slice(0, 10),
      DueDate: bill.dueAt ? bill.dueAt.toISOString().slice(0, 10) : null,
      PrivateNote: bill.notes,
      AdelStatus: bill.status,
      Line: priced,
      TotalAmt: dollars(summary.totalCents),
      Balance: dollars(balanceCents),
    },
  });
}

async function syncBillPayment(ctx: Ctx, payment: typeof billPayments.$inferSelect, bill: typeof bills.$inferSelect, overwrite = false) {
  if (payment.status !== "succeeded") {
    ctx.summary.skipped += 1;
    return "skipped" as const;
  }
  const billOutcome = await syncBill(ctx, bill);
  if (billOutcome === "failed" || billOutcome === "conflict") throw new QboSandboxError(`Bill ${bill.number} did not sync.`);
  const billQboId = await requireMapped(ctx, "bill", bill.id, `bill ${bill.number}`);
  const vendorQboId = await requireMapped(ctx, "vendor", bill.vendorId, "vendor");
  const local = { amountCents: payment.amountCents, status: payment.status, method: payment.method, reference: payment.reference, billId: payment.billId };
  return syncResource(ctx, {
    resourceType: "bill_payment",
    resourceId: payment.id,
    label: `bill payment ${payment.amountCents}`,
    localHash: hashJson(local),
    localTotalCents: payment.amountCents,
    overwrite,
    payload: {
      TotalAmt: dollars(payment.amountCents),
      VendorRef: { value: vendorQboId },
      PayType: "Check",
      PrivateNote: payment.reference ?? payment.method,
      Line: [{ Amount: dollars(payment.amountCents), LinkedTxn: [{ TxnId: billQboId, TxnType: "Bill" }] }],
    },
  });
}

async function attachOrCreateCustomer(ctx: Ctx, remote: QboObject) {
  const name = String(remote.DisplayName ?? "").trim();
  if (!name) return;
  const [mapped] = await db
    .select()
    .from(qboMappings)
    .where(and(eq(qboMappings.realmId, ctx.realmId), eq(qboMappings.resourceType, "customer"), eq(qboMappings.qboId, remote.Id)));
  if (mapped) return;
  const [brand] = await db.select().from(brands).where(eq(brands.entityId, ctx.entityId)).limit(1);
  if (!brand) return;
  const emailObj = remote.PrimaryEmailAddr as { Address?: string } | null;
  const phoneObj = remote.PrimaryPhone as { FreeFormNumber?: string } | null;
  const local = { name, email: emailObj?.Address ?? null, phone: phoneObj?.FreeFormNumber ?? null, notes: typeof remote.Notes === "string" ? remote.Notes : null };
  const [sameName] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.entityId, ctx.entityId), eq(customers.name, name)));
  const unmapped = sameName ? await mappingFor(ctx.entityId, "customer", sameName.id) : null;
  const row =
    sameName && !unmapped
      ? sameName
      : (
          await db
            .insert(customers)
            .values({ entityId: ctx.entityId, brandId: brand.id, ...local })
            .returning()
        )[0];
  await db.update(customers).set({ ...local, updatedAt: new Date() }).where(eq(customers.id, row.id));
  await saveMapping(ctx.entityId, "customer", row.id, ctx.realmId, remote, hashJson(local));
  await putState(ctx.entityId, "customer", row.id, "synced", 0, null, null);
  await logSync(ctx.entityId, "customer", row.id, "pull", "synced", 0, `Pulled customer ${name} from QuickBooks.`);
  ctx.summary.remoteCreated += 1;
  ctx.summary.pulled += 1;
}

async function attachOrCreateItem(ctx: Ctx, remote: QboObject) {
  const name = String(remote.Name ?? "").trim();
  if (!name) return;
  const [mapped] = await db
    .select()
    .from(qboMappings)
    .where(and(eq(qboMappings.realmId, ctx.realmId), eq(qboMappings.resourceType, "item"), eq(qboMappings.qboId, remote.Id)));
  if (mapped) return;
  const kind: "labor" | "material" = remote.Type === "Service" ? "labor" : "material";
  const local = {
    name,
    description: typeof remote.Description === "string" ? remote.Description : null,
    kind,
    sku: typeof remote.Sku === "string" ? remote.Sku : null,
    unitAmountCents: centsFromDollars(remote.UnitPrice) ?? 0,
    taxable: remote.Taxable === true,
    active: remote.Active !== false,
  };
  const [sameName] = await db.select().from(catalogItems).where(and(eq(catalogItems.entityId, ctx.entityId), eq(catalogItems.name, name)));
  const unmapped = sameName ? await mappingFor(ctx.entityId, "item", sameName.id) : null;
  const row = sameName && !unmapped ? sameName : (await db.insert(catalogItems).values({ entityId: ctx.entityId, ...local }).returning())[0];
  await db.update(catalogItems).set({ ...local, updatedAt: new Date() }).where(eq(catalogItems.id, row.id));
  await saveMapping(ctx.entityId, "item", row.id, ctx.realmId, remote, hashJson(local));
  await putState(ctx.entityId, "item", row.id, "synced", 0, null, null);
  await logSync(ctx.entityId, "item", row.id, "pull", "synced", 0, `Pulled item ${name} from QuickBooks.`);
  ctx.summary.remoteCreated += 1;
  ctx.summary.pulled += 1;
}

async function attachOrCreateVendor(ctx: Ctx, remote: QboObject) {
  const name = String(remote.DisplayName ?? "").trim();
  if (!name) return;
  const [mapped] = await db
    .select()
    .from(qboMappings)
    .where(and(eq(qboMappings.realmId, ctx.realmId), eq(qboMappings.resourceType, "vendor"), eq(qboMappings.qboId, remote.Id)));
  if (mapped) return;
  const local = { name, notes: typeof remote.Notes === "string" ? remote.Notes : null };
  const [sameName] = await db.select().from(vendors).where(and(eq(vendors.entityId, ctx.entityId), eq(vendors.name, name)));
  const unmapped = sameName ? await mappingFor(ctx.entityId, "vendor", sameName.id) : null;
  const row = sameName && !unmapped ? sameName : (await db.insert(vendors).values({ entityId: ctx.entityId, ...local }).returning())[0];
  await db.update(vendors).set({ ...local, updatedAt: new Date() }).where(eq(vendors.id, row.id));
  await saveMapping(ctx.entityId, "vendor", row.id, ctx.realmId, remote, hashJson(local));
  await putState(ctx.entityId, "vendor", row.id, "synced", 0, null, null);
  await logSync(ctx.entityId, "vendor", row.id, "pull", "synced", 0, `Pulled vendor ${name} from QuickBooks.`);
  ctx.summary.remoteCreated += 1;
  ctx.summary.pulled += 1;
}

async function finish(ctx: Ctx) {
  const summary = ctx.summary;
  if (!summary.pushed && !summary.pulled && !summary.conflicts && !summary.failed && !summary.remoteCreated) return summary;
  try {
    await db.transaction(async (tx) => {
      if (summary.pushed || summary.pulled || summary.remoteCreated) {
        await emitEvent(tx, "qbo.synced", { ...summary }, ctx.entityId);
      }
      if (summary.conflicts) await emitEvent(tx, "qbo.conflict", { realmId: ctx.realmId, conflicts: summary.conflicts }, ctx.entityId);
      if (summary.failed) await emitEvent(tx, "qbo.failed", { realmId: ctx.realmId, failed: summary.failed }, ctx.entityId);
    });
    await safeDeliver();
  } catch (err) {
    console.error("quickbooks webhook failed", err);
  }
  return summary;
}

export async function syncEntity(entityId: string, options: { force?: boolean } = {}) {
  if (!quickBooksPluginEnabled()) return emptySummary();
  assertNotProductionEnv();
  const [connection] = await db.select().from(qboConnections).where(eq(qboConnections.entityId, entityId));
  if (!connection) return emptySummary();
  const provider = await providerFor(connection);
  const summary = emptySummary();
  summary.connected = true;
  summary.realmId = connection.realmId;
  summary.provider = connection.provider;
  const ctx: Ctx = { entityId, realmId: connection.realmId, provider, summary, force: options.force ?? false };

  for (const item of await db.select().from(catalogItems).where(eq(catalogItems.entityId, entityId))) {
    await syncItem(ctx, item);
  }
  for (const customer of await db.select().from(customers).where(eq(customers.entityId, entityId))) {
    await syncCustomer(ctx, customer);
  }
  for (const vendor of await db.select().from(vendors).where(eq(vendors.entityId, entityId))) {
    await syncVendor(ctx, vendor);
  }
  for (const remote of await provider.list(connection.realmId, "Customer")) await attachOrCreateCustomer(ctx, remote);
  for (const remote of await provider.list(connection.realmId, "Item")) await attachOrCreateItem(ctx, remote);
  for (const remote of await provider.list(connection.realmId, "Vendor")) await attachOrCreateVendor(ctx, remote);

  const invoiceRows = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.entityId, entityId), inArray(invoices.status, ["issued", "partial", "paid", "void"])));
  for (const invoice of invoiceRows) {
    try {
      await syncInvoice(ctx, invoice);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invoice sync failed.";
      const state = await stateFor(entityId, "invoice", invoice.id);
      const nextAttempt = (state?.attemptCount ?? 0) + 1;
      await logSync(entityId, "invoice", invoice.id, "push", "failed", nextAttempt, `invoice ${invoice.number} failed: ${message}`);
      await putState(entityId, "invoice", invoice.id, "failed", nextAttempt, message, backoff(nextAttempt));
      summary.failed += 1;
    }
  }

  const paymentRows = await db
    .select({ payment: payments, invoice: invoices })
    .from(payments)
    .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
    .where(and(eq(invoices.entityId, entityId), eq(payments.status, "succeeded")));
  for (const row of paymentRows) {
    try {
      await syncPayment(ctx, row.payment, row.invoice);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Payment sync failed.";
      const state = await stateFor(entityId, "payment", row.payment.id);
      const nextAttempt = (state?.attemptCount ?? 0) + 1;
      await logSync(entityId, "payment", row.payment.id, "push", "failed", nextAttempt, message);
      await putState(entityId, "payment", row.payment.id, "failed", nextAttempt, message, backoff(nextAttempt));
      summary.failed += 1;
    }
  }

  const billRows = await db
    .select()
    .from(bills)
    .where(and(eq(bills.entityId, entityId), inArray(bills.status, ["issued", "partial", "paid", "void"])));
  for (const bill of billRows) {
    try {
      await syncBill(ctx, bill);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Bill sync failed.";
      const state = await stateFor(entityId, "bill", bill.id);
      const nextAttempt = (state?.attemptCount ?? 0) + 1;
      await logSync(entityId, "bill", bill.id, "push", "failed", nextAttempt, `bill ${bill.number} failed: ${message}`);
      await putState(entityId, "bill", bill.id, "failed", nextAttempt, message, backoff(nextAttempt));
      summary.failed += 1;
    }
  }

  const billPayRows = await db
    .select({ payment: billPayments, bill: bills })
    .from(billPayments)
    .innerJoin(bills, eq(bills.id, billPayments.billId))
    .where(and(eq(bills.entityId, entityId), eq(billPayments.status, "succeeded")));
  for (const row of billPayRows) {
    try {
      await syncBillPayment(ctx, row.payment, row.bill);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Bill payment sync failed.";
      const state = await stateFor(entityId, "bill_payment", row.payment.id);
      const nextAttempt = (state?.attemptCount ?? 0) + 1;
      await logSync(entityId, "bill_payment", row.payment.id, "push", "failed", nextAttempt, message);
      await putState(entityId, "bill_payment", row.payment.id, "failed", nextAttempt, message, backoff(nextAttempt));
      summary.failed += 1;
    }
  }

  return finish(ctx);
}

export async function afterBooksChange(entityId: string) {
  if (!quickBooksPluginEnabled()) return;
  try {
    const [row] = await db.select({ id: qboConnections.id }).from(qboConnections).where(eq(qboConnections.entityId, entityId));
    if (!row) return;
    await syncEntity(entityId, { force: false });
  } catch (err) {
    console.error("quickbooks sync failed", err);
  }
}

export async function getQuickBooks(actor: Actor) {
  assertOffice(actor);
  assertQuickBooksPlugin();
  const [connection] = await db.select().from(qboConnections).where(eq(qboConnections.entityId, actor.entityId));
  const [counts] = await db
    .select({
      conflicts: sql<number>`count(*) filter (where ${qboSyncState.status} = 'conflict')::int`,
      failed: sql<number>`count(*) filter (where ${qboSyncState.status} = 'failed')::int`,
    })
    .from(qboSyncState)
    .where(eq(qboSyncState.entityId, actor.entityId));
  return {
    data: {
      connection: connection ? publicConnection(connection) : null,
      conflicts: counts?.conflicts ?? 0,
      failed: counts?.failed ?? 0,
    },
  };
}

export async function connectQuickBooks(actor: Actor) {
  assertOffice(actor);
  assertQuickBooksPlugin();
  assertNotProductionEnv();
  const [entity] = await db.select().from(entities).where(eq(entities.id, actor.entityId));
  if (!entity) throw notFound("Company not found.");
  if ((process.env.QBO_PROVIDER ?? "mock") === "intuit") {
    if (!intuitSandboxConfigured()) {
      throw new AppError(400, "QBO_PROVIDER=intuit needs Intuit sandbox keys. Live keys are refused.", "qbo_not_configured");
    }
    return { data: { connected: false as const, authorizationUrl: sandboxAuthorizeUrl(actor.entityId), environment: "sandbox" as const, provider: "intuit" as const } };
  }
  const realmId = `mock-sandbox-${entity.slug}`;
  const [taken] = await db.select().from(qboConnections).where(eq(qboConnections.realmId, realmId));
  if (taken && taken.entityId !== entity.id) {
    throw new AppError(409, "That QuickBooks company is already connected to the other partition.", "qbo_realm_taken");
  }
  const [existing] = await db.select().from(qboConnections).where(eq(qboConnections.entityId, entity.id));
  if (existing) return { data: { ...publicConnection(existing), connected: true as const, authorizationUrl: null } };
  const [row] = await db
    .insert(qboConnections)
    .values({
      entityId: entity.id,
      environment: "sandbox",
      provider: "mock",
      realmId,
      companyName: `${entity.name} sandbox`,
    })
    .returning();
  return { data: { ...publicConnection(row), connected: true as const, authorizationUrl: null } };
}

export async function disconnectQuickBooks(actor: Actor) {
  assertOffice(actor);
  assertQuickBooksPlugin();
  await db.delete(qboConnections).where(eq(qboConnections.entityId, actor.entityId));
  return { data: { connected: false } };
}

export async function syncQuickBooks(actor: Actor) {
  assertOffice(actor);
  assertQuickBooksPlugin();
  const summary = await syncEntity(actor.entityId, { force: true });
  if (!summary.connected) throw new AppError(409, "Connect this company to its QuickBooks sandbox first.", "qbo_not_connected");
  return { data: summary };
}

export async function retryQuickBooks(actor: Actor, input: unknown) {
  assertOffice(actor);
  assertQuickBooksPlugin();
  const force = Boolean(input && typeof input === "object" && "force" in input && (input as { force?: unknown }).force === true);
  const summary = await syncEntity(actor.entityId, { force });
  if (!summary.connected) throw new AppError(409, "Connect this company to its QuickBooks sandbox first.", "qbo_not_connected");
  return { data: summary };
}

export async function listQuickBooksLog(actor: Actor) {
  assertOffice(actor);
  assertQuickBooksPlugin();
  const rows = await db
    .select({
      id: qboSyncLog.id,
      resourceType: qboSyncLog.resourceType,
      resourceId: qboSyncLog.resourceId,
      direction: qboSyncLog.direction,
      status: qboSyncLog.status,
      attemptCount: qboSyncLog.attemptCount,
      message: qboSyncLog.message,
      createdAt: qboSyncLog.createdAt,
    })
    .from(qboSyncLog)
    .where(eq(qboSyncLog.entityId, actor.entityId))
    .orderBy(desc(qboSyncLog.createdAt))
    .limit(50);
  return { data: rows };
}

async function labelFor(entityId: string, resourceType: QboResource, resourceId: string) {
  if (resourceType === "customer") {
    const [row] = await db.select({ name: customers.name }).from(customers).where(and(eq(customers.id, resourceId), eq(customers.entityId, entityId)));
    return row ? `Customer ${row.name}` : "Customer";
  }
  if (resourceType === "item") {
    const [row] = await db.select({ name: catalogItems.name }).from(catalogItems).where(and(eq(catalogItems.id, resourceId), eq(catalogItems.entityId, entityId)));
    return row ? `Item ${row.name}` : "Item";
  }
  if (resourceType === "vendor") {
    const [row] = await db.select({ name: vendors.name }).from(vendors).where(and(eq(vendors.id, resourceId), eq(vendors.entityId, entityId)));
    return row ? `Vendor ${row.name}` : "Vendor";
  }
  if (resourceType === "invoice") {
    const [row] = await db.select({ number: invoices.number }).from(invoices).where(and(eq(invoices.id, resourceId), eq(invoices.entityId, entityId)));
    return row ? `Invoice ${row.number}` : "Invoice";
  }
  if (resourceType === "bill") {
    const [row] = await db.select({ number: bills.number }).from(bills).where(and(eq(bills.id, resourceId), eq(bills.entityId, entityId)));
    return row ? `Bill ${row.number}` : "Bill";
  }
  return resourceType.replaceAll("_", " ");
}

export async function listQuickBooksConflicts(actor: Actor) {
  assertOffice(actor);
  assertQuickBooksPlugin();
  const rows = await db
    .select()
    .from(qboSyncState)
    .where(and(eq(qboSyncState.entityId, actor.entityId), eq(qboSyncState.status, "conflict")));
  const data = [];
  for (const row of rows) {
    data.push({
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      message: row.lastError,
      label: await labelFor(actor.entityId, row.resourceType, row.resourceId),
      updatedAt: row.updatedAt,
    });
  }
  return { data };
}

export async function resolveQuickBooksConflict(actor: Actor, input: unknown) {
  assertOffice(actor);
  assertQuickBooksPlugin();
  const body = input as { resourceType?: string; resourceId?: string; choice?: string };
  const resourceType = body.resourceType as QboResource;
  const resourceId = body.resourceId ?? "";
  const choice = body.choice;
  if (!QBO_TYPE[resourceType] || !resourceId || (choice !== "local" && choice !== "remote")) {
    throw new AppError(400, "Say which record to keep.", "invalid_input");
  }
  const state = await stateFor(actor.entityId, resourceType, resourceId);
  if (!state || state.status !== "conflict") throw notFound("That conflict is not open.");
  if (choice === "remote" && !PULLABLE.has(resourceType)) {
    throw new AppError(409, "Issued invoices and payments stay in Adel Service. Keep our version to overwrite QuickBooks.", "qbo_conflict");
  }
  const [connection] = await db.select().from(qboConnections).where(eq(qboConnections.entityId, actor.entityId));
  if (!connection) throw new AppError(409, "Connect this company to its QuickBooks sandbox first.", "qbo_not_connected");
  const provider = await providerFor(connection);
  const ctx: Ctx = { entityId: actor.entityId, realmId: connection.realmId, provider, summary: emptySummary(), force: true };
  ctx.summary.connected = true;
  if (resourceType === "customer") {
    const [row] = await db.select().from(customers).where(and(eq(customers.id, resourceId), eq(customers.entityId, actor.entityId)));
    if (!row) throw notFound("Customer not found.");
    await syncCustomer(ctx, row, { overwrite: choice === "local", preferRemote: choice === "remote" });
  } else if (resourceType === "item") {
    const [row] = await db.select().from(catalogItems).where(and(eq(catalogItems.id, resourceId), eq(catalogItems.entityId, actor.entityId)));
    if (!row) throw notFound("Item not found.");
    await syncItem(ctx, row, { overwrite: choice === "local", preferRemote: choice === "remote" });
  } else if (resourceType === "vendor") {
    const [row] = await db.select().from(vendors).where(and(eq(vendors.id, resourceId), eq(vendors.entityId, actor.entityId)));
    if (!row) throw notFound("Vendor not found.");
    await syncVendor(ctx, row, { overwrite: choice === "local", preferRemote: choice === "remote" });
  } else if (resourceType === "invoice") {
    const [row] = await db.select().from(invoices).where(and(eq(invoices.id, resourceId), eq(invoices.entityId, actor.entityId)));
    if (!row) throw notFound("Invoice not found.");
    await syncInvoice(ctx, row, true);
  } else if (resourceType === "bill") {
    const [row] = await db.select().from(bills).where(and(eq(bills.id, resourceId), eq(bills.entityId, actor.entityId)));
    if (!row) throw notFound("Bill not found.");
    await syncBill(ctx, row, true);
  } else if (resourceType === "payment") {
    const [payment] = await db.select().from(payments).where(eq(payments.id, resourceId));
    if (!payment) throw notFound("Payment not found.");
    const [invoice] = await db.select().from(invoices).where(and(eq(invoices.id, payment.invoiceId), eq(invoices.entityId, actor.entityId)));
    if (!invoice) throw notFound("Payment not found.");
    await syncPayment(ctx, payment, invoice, true);
  } else if (resourceType === "bill_payment") {
    const [payment] = await db.select().from(billPayments).where(eq(billPayments.id, resourceId));
    if (!payment) throw notFound("Bill payment not found.");
    const [bill] = await db.select().from(bills).where(and(eq(bills.id, payment.billId), eq(bills.entityId, actor.entityId)));
    if (!bill) throw notFound("Bill payment not found.");
    await syncBillPayment(ctx, payment, bill, true);
  }
  const after = await stateFor(actor.entityId, resourceType, resourceId);
  if (after?.status === "conflict") {
    throw new AppError(409, after.lastError ?? "The conflict is still open.", "qbo_conflict");
  }
  return { data: { resourceType, resourceId, status: after?.status ?? "synced" } };
}

export async function completeSandboxOAuth(actor: Actor, input: { code: string | null; state: string | null; realmId: string | null }) {
  assertOffice(actor);
  assertQuickBooksPlugin();
  assertNotProductionEnv();
  if (!intuitSandboxConfigured()) {
    throw new AppError(400, "Intuit sandbox keys are not configured. Use Connect sandbox for the built-in mock company.", "qbo_not_configured");
  }
  if (!input.code || !input.state || !input.realmId || !/^\d+$/.test(input.realmId)) {
    throw new AppError(400, "QuickBooks did not return a sandbox company id.", "invalid_input");
  }
  const entityId = readOAuthState(input.state);
  if (!entityId || entityId !== actor.entityId) {
    throw new AppError(400, "That QuickBooks connection is for a different company. Switch companies and try again.", "invalid_input");
  }
  const [taken] = await db.select().from(qboConnections).where(eq(qboConnections.realmId, input.realmId));
  if (taken && taken.entityId !== actor.entityId) {
    throw new AppError(409, "That QuickBooks company is already connected to the other partition.", "qbo_realm_taken");
  }
  const tokens = await exchangeSandboxCode(input.code);
  const [entity] = await db.select().from(entities).where(eq(entities.id, actor.entityId));
  if (!entity) throw notFound("Company not found.");
  const [existing] = await db.select().from(qboConnections).where(eq(qboConnections.entityId, actor.entityId));
  if (existing && existing.realmId !== input.realmId) {
    await db.delete(qboMappings).where(eq(qboMappings.entityId, actor.entityId));
    await db.delete(qboSyncState).where(eq(qboSyncState.entityId, actor.entityId));
  }
  const values = {
    entityId: actor.entityId,
    environment: "sandbox" as const,
    provider: "intuit" as const,
    realmId: input.realmId,
    companyName: `${entity.name} sandbox`,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    tokenExpiresAt: tokens.expiresAt,
    updatedAt: new Date(),
  };
  const [row] = existing
    ? await db.update(qboConnections).set(values).where(eq(qboConnections.id, existing.id)).returning()
    : await db.insert(qboConnections).values(values).returning();
  return publicConnection(row);
}

export async function quickBooksStatusFor(entityId: string, resourceType: QboResource, resourceId: string) {
  const state = await stateFor(entityId, resourceType, resourceId);
  return state?.status ?? "not_synced";
}
