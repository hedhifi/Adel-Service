import { ADEL_ENTITY_ID, SERVICE_BRAND_ID, SERVICE_ENTITY_ID, db, qboConnections, qboSandboxObjects, webhookDeliveries } from "@adel/db";
import { and, eq } from "drizzle-orm";
import {
  AppError,
  IntuitSandboxProvider,
  connectQuickBooks,
  exportBooks,
  getBooks,
  createApiToken,
  createCatalogItem,
  createChargeFromVisit,
  createCustomer,
  createIntercompanyRate,
  createInvoice,
  createJob,
  createProperty,
  createWebhookEndpoint,
  exportEntity,
  generateIntercompanyInvoice,
  getReconciliation,
  issueInvoice,
  listCustomers,
  listInvoices,
  listQuickBooksConflicts,
  recordManualPayment,
  resolveQuickBooksConflict,
  retryQuickBooks,
  scheduleVisit,
  syncQuickBooks,
  updateCustomer,
} from "@adel/core";
import { afterEach, describe, expect, it } from "vitest";
import { GET as quickBooksRoute } from "../apps/web/src/app/api/v1/qbo/route";
import { asActor, seedCompany } from "./helpers";

const savedEnv = {
  QBO_ENVIRONMENT: process.env.QBO_ENVIRONMENT,
  QBO_PROVIDER: process.env.QBO_PROVIDER,
  QBO_CLIENT_ID: process.env.QBO_CLIENT_ID,
  QBO_CLIENT_SECRET: process.env.QBO_CLIENT_SECRET,
  ACCOUNTING_PROVIDER: process.env.ACCOUNTING_PROVIDER,
};

function restoreEnv(
  name: "QBO_ENVIRONMENT" | "QBO_PROVIDER" | "QBO_CLIENT_ID" | "QBO_CLIENT_SECRET" | "ACCOUNTING_PROVIDER",
  value: string | undefined,
) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  restoreEnv("QBO_ENVIRONMENT", savedEnv.QBO_ENVIRONMENT);
  restoreEnv("QBO_PROVIDER", savedEnv.QBO_PROVIDER);
  restoreEnv("QBO_CLIENT_ID", savedEnv.QBO_CLIENT_ID);
  restoreEnv("QBO_CLIENT_SECRET", savedEnv.QBO_CLIENT_SECRET);
  restoreEnv("ACCOUNTING_PROVIDER", savedEnv.ACCOUNTING_PROVIDER);
});

function payloadName(row: { payload: unknown }) {
  const body = row.payload as { DisplayName?: string; Name?: string };
  return body.DisplayName ?? body.Name ?? "";
}

describe("quickbooks sandbox", () => {
  it("keeps each company in its own sandbox and refuses production", async () => {
    process.env.ACCOUNTING_PROVIDER = "quickbooks";
    const { office, adel } = await seedCompany();
    const service = asActor(office, SERVICE_ENTITY_ID);
    const adelBooks = await connectQuickBooks(office);
    const serviceBooks = await connectQuickBooks(service);
    expect(adelBooks.data.connected).toBe(true);
    expect(adelBooks.data.realmId).toBe("mock-sandbox-adel-electric");
    expect(serviceBooks.data.realmId).toBe("mock-sandbox-service-contracts");
    expect(adelBooks.data.realmId).not.toBe(serviceBooks.data.realmId);

    const customer = await createCustomer(office, { brandId: adel.id, name: "Camille Calder", email: "camille@example.com" });
    await createCatalogItem(office, { name: "LED driver", kind: "material", unitAmountCents: 4200, taxable: true });
    const property = await createProperty(office, customer.data.id, { label: "House", line1: "1 Gulf", city: "Naples", postalCode: "34102" });
    const job = await createJob(office, { customerId: customer.data.id, propertyId: property.data.id, brandId: adel.id, title: "Panel" });
    const invoice = await createInvoice(office, {
      jobId: job.data.id,
      lineItems: [{ kind: "material", description: "LED driver", quantity: "2", unitAmountCents: 4200, taxable: true }],
    });
    await issueInvoice(office, invoice.data.id);
    await recordManualPayment(office, invoice.data.id, { method: "check", amountCents: invoice.data.totalCents, reference: "1008" });

    const adelRows = await db.select().from(qboSandboxObjects).where(eq(qboSandboxObjects.realmId, "mock-sandbox-adel-electric"));
    expect(adelRows.map((row) => row.qboType).sort()).toEqual(expect.arrayContaining(["Customer", "Invoice", "Item", "Payment"]));
    const serviceRows = await db.select().from(qboSandboxObjects).where(eq(qboSandboxObjects.realmId, "mock-sandbox-service-contracts"));
    expect(serviceRows.some((row) => payloadName(row) === "Camille Calder")).toBe(false);

    await db.update(qboConnections).set({ accessToken: "sandbox-token-secret" }).where(eq(qboConnections.entityId, ADEL_ENTITY_ID));
    const exported = await exportEntity(office);
    expect(JSON.stringify(exported.data)).not.toContain("sandbox-token-secret");
    expect(exported.data.quickbooks[0]?.realmId).toBe("mock-sandbox-adel-electric");

    const token = await createApiToken(asActor(office, ADEL_ENTITY_ID, [{ entityId: ADEL_ENTITY_ID, name: "Adel Electric", role: "admin" }]), {
      name: "Adel books",
      role: "office",
    });
    const response = await quickBooksRoute(
      new Request("http://localhost/api/v1/qbo", { headers: { authorization: `Bearer ${token.secret}` } }),
      { params: Promise.resolve({}) },
    );
    const body = (await response.json()) as { data: { connection: { realmId: string } } };
    expect(body.data.connection.realmId).toBe("mock-sandbox-adel-electric");
    expect(JSON.stringify(body)).not.toContain("mock-sandbox-service-contracts");

    process.env.QBO_ENVIRONMENT = "production";
    await expect(syncQuickBooks(office)).rejects.toMatchObject({ code: "qbo_production_refused" });
    process.env.QBO_ENVIRONMENT = "sandbox";
    process.env.QBO_PROVIDER = "intuit";
    process.env.QBO_CLIENT_ID = "production-client";
    process.env.QBO_CLIENT_SECRET = "not-a-live-secret";
    await expect(connectQuickBooks(office)).rejects.toBeInstanceOf(AppError);

    expect(() => new IntuitSandboxProvider("token", fetch, "https://quickbooks.api.intuit.com")).toThrow(AppError);
    const calls: string[] = [];
    const provider = new IntuitSandboxProvider("sandbox-token", async (input) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ Customer: { Id: "9", SyncToken: "0", DisplayName: "A" } }), { status: 200 });
    });
    const saved = await provider.upsert("12345", "Customer", { DisplayName: "A" });
    expect(saved.Id).toBe("9");
    expect(calls[0]).toContain("https://sandbox-quickbooks.api.intuit.com/v3/company/12345/customer");
  });

  it("records a conflict and retries a failed sandbox write", async () => {
    process.env.ACCOUNTING_PROVIDER = "quickbooks";
    const { office, adel } = await seedCompany();
    await connectQuickBooks(office);
    const customer = await createCustomer(office, { brandId: adel.id, name: "Helen Cho" });
    const [remote] = await db
      .select()
      .from(qboSandboxObjects)
      .where(and(eq(qboSandboxObjects.realmId, "mock-sandbox-adel-electric"), eq(qboSandboxObjects.qboType, "Customer")));
    const body = remote.payload as Record<string, unknown>;
    await db
      .update(qboSandboxObjects)
      .set({
        syncToken: remote.syncToken + 1,
        payload: { ...body, DisplayName: "Changed in QuickBooks", SyncToken: String(remote.syncToken + 1) },
      })
      .where(
        and(
          eq(qboSandboxObjects.realmId, remote.realmId),
          eq(qboSandboxObjects.qboType, remote.qboType),
          eq(qboSandboxObjects.qboId, remote.qboId),
        ),
      );
    await updateCustomer(office, customer.data.id, { name: "Changed here" });
    const conflicts = await listQuickBooksConflicts(office);
    expect(conflicts.data.map((row) => row.resourceType)).toContain("customer");
    const during = await db
      .select()
      .from(qboSandboxObjects)
      .where(and(eq(qboSandboxObjects.realmId, remote.realmId), eq(qboSandboxObjects.qboId, remote.qboId), eq(qboSandboxObjects.qboType, "Customer")));
    expect(payloadName(during[0])).toBe("Changed in QuickBooks");

    await resolveQuickBooksConflict(office, { resourceType: "customer", resourceId: customer.data.id, choice: "local" });
    const kept = await db
      .select()
      .from(qboSandboxObjects)
      .where(and(eq(qboSandboxObjects.realmId, remote.realmId), eq(qboSandboxObjects.qboType, "Customer"), eq(qboSandboxObjects.qboId, remote.qboId)));
    expect(payloadName(kept[0])).toBe("Changed here");
    expect((await listQuickBooksConflicts(office)).data).toHaveLength(0);

    const { failNextSandboxWrites, resetSandboxFaults } = await import("@adel/core");
    resetSandboxFaults();
    failNextSandboxWrites(1);
    const other = await createCustomer(office, { brandId: adel.id, name: "Anya Shah" });
    const missing = await db.select().from(qboSandboxObjects).where(eq(qboSandboxObjects.qboType, "Customer"));
    expect(missing.some((row) => payloadName(row) === "Anya Shah")).toBe(false);
    await retryQuickBooks(office, {});
    const still = await db.select().from(qboSandboxObjects).where(eq(qboSandboxObjects.qboType, "Customer"));
    expect(still.some((row) => payloadName(row) === "Anya Shah")).toBe(false);
    await retryQuickBooks(office, { force: true });
    const synced = await db.select().from(qboSandboxObjects).where(eq(qboSandboxObjects.qboType, "Customer"));
    expect(synced.some((row) => payloadName(row) === "Anya Shah")).toBe(true);
    expect(other.data.name).toBe("Anya Shah");
    resetSandboxFaults();
  });
});

describe("intercompany billing", () => {
  it("invoices one company, bills the other, and posts both to QuickBooks", async () => {
    process.env.ACCOUNTING_PROVIDER = "quickbooks";
    const { office, tech, adel } = await seedCompany();
    const service = asActor(office, SERVICE_ENTITY_ID);
    await connectQuickBooks(office);
    await connectQuickBooks(service);
    await createWebhookEndpoint(office, { url: "https://example.com/adel-hooks", events: ["intercompany.invoiced", "qbo.synced", "intercompany.settled"] });

    const rate = await createIntercompanyRate(office, {
      supplyingEntityId: ADEL_ENTITY_ID,
      consumingEntityId: SERVICE_ENTITY_ID,
      kind: "labor",
      name: "Field technician hour",
      unit: "hour",
      unitAmountCents: 9500,
    });
    const onlyAdel = asActor(office, ADEL_ENTITY_ID, [{ entityId: ADEL_ENTITY_ID, name: "Adel Electric", role: "office" }]);
    await expect(
      createIntercompanyRate(onlyAdel, {
        supplyingEntityId: ADEL_ENTITY_ID,
        consumingEntityId: SERVICE_ENTITY_ID,
        kind: "shared",
        name: "Desk",
        unit: "month",
        unitAmountCents: 100,
      }),
    ).rejects.toMatchObject({ status: 403 });

    const customer = await createCustomer(service, { brandId: SERVICE_BRAND_ID, name: "Palm Court HOA" });
    const property = await createProperty(service, customer.data.id, { label: "House", line1: "9 Dock", city: "Naples", postalCode: "34102" });
    const job = await createJob(service, {
      customerId: customer.data.id,
      propertyId: property.data.id,
      brandId: SERVICE_BRAND_ID,
      title: "Quarterly lighting check",
    });
    const visit = await scheduleVisit(service, {
      jobId: job.data.id,
      technicianId: tech.id,
      scheduledStart: "2026-10-20T14:00:00.000Z",
      scheduledEnd: "2026-10-20T16:00:00.000Z",
    });
    const charge = await createChargeFromVisit(office, { visitId: visit.data.id, supplyingEntityId: ADEL_ENTITY_ID, rateId: rate.data.id });
    expect(charge.data.quantity).toBe("2.00");
    expect(charge.data.amountCents).toBe(19000);
    expect(charge.data.consumingEntityId).toBe(SERVICE_ENTITY_ID);

    const material = await createIntercompanyRate(office, {
      supplyingEntityId: ADEL_ENTITY_ID,
      consumingEntityId: SERVICE_ENTITY_ID,
      kind: "material",
      name: "Materials at cost",
      unit: "each",
      unitAmountCents: 0,
    });
    const { createIntercompanyCharge } = await import("@adel/core");
    await createIntercompanyCharge(office, {
      supplyingEntityId: ADEL_ENTITY_ID,
      consumingEntityId: SERVICE_ENTITY_ID,
      rateId: material.data.id,
      quantity: "1.00",
      unitAmountCents: 2500,
      description: "Shared LED lamps",
    });

    const generated = await generateIntercompanyInvoice(office, { supplyingEntityId: ADEL_ENTITY_ID, consumingEntityId: SERVICE_ENTITY_ID });
    expect(generated.data.totalCents).toBe(21500);
    const adelInvoices = await listInvoices(office, {});
    expect(adelInvoices.data.some((row) => row.id === generated.data.invoiceId)).toBe(true);
    const serviceInvoices = await listInvoices(service, {});
    expect(serviceInvoices.data.some((row) => row.id === generated.data.invoiceId)).toBe(false);
    expect((await listCustomers(service, {})).data.some((row) => row.name === "Service Contracts")).toBe(false);

    const adelView = await getReconciliation(office);
    expect(adelView.data.receivableCents).toBe(21500);
    expect(adelView.data.payableCents).toBe(0);
    expect(adelView.data.pairs[0]?.inBalance).toBe(true);
    expect(adelView.data.pairs[0]?.bothPosted).toBe(true);
    const serviceView = await getReconciliation(service);
    expect(serviceView.data.payableCents).toBe(21500);
    expect(serviceView.data.receivableCents).toBe(0);

    const adelObjects = await db.select().from(qboSandboxObjects).where(eq(qboSandboxObjects.realmId, "mock-sandbox-adel-electric"));
    const serviceObjects = await db.select().from(qboSandboxObjects).where(eq(qboSandboxObjects.realmId, "mock-sandbox-service-contracts"));
    expect(adelObjects.some((row) => row.qboType === "Invoice")).toBe(true);
    expect(adelObjects.some((row) => row.qboType === "Bill")).toBe(false);
    expect(serviceObjects.some((row) => row.qboType === "Bill")).toBe(true);
    expect(serviceObjects.some((row) => row.qboType === "Invoice")).toBe(false);

    const adelExport = await exportEntity(office);
    expect(adelExport.data.bills.some((row) => row.id === generated.data.billId)).toBe(false);
    expect(adelExport.data.links.some((row) => row.kind === "intercompany_invoice" && row.toRecordId === generated.data.billId)).toBe(true);
    const serviceExport = await exportEntity(service);
    expect(serviceExport.data.invoices.some((row) => row.id === generated.data.invoiceId)).toBe(false);
    expect(serviceExport.data.bills.some((row) => row.id === generated.data.billId)).toBe(true);
    expect(JSON.stringify(serviceExport.data.customers)).not.toContain(adel.id);

    const settled = await (await import("@adel/core")).settleIntercompany(office, {
      linkId: generated.data.linkId,
      amountCents: 21500,
      reference: "ACH 44",
    });
    expect(settled.data.receivableCents).toBe(0);
    const paid = await db.select().from(qboSandboxObjects);
    expect(paid.some((row) => row.realmId === "mock-sandbox-adel-electric" && row.qboType === "Payment")).toBe(true);
    expect(paid.some((row) => row.realmId === "mock-sandbox-service-contracts" && row.qboType === "BillPayment")).toBe(true);

    const deliveries = await db.select().from(webhookDeliveries);
    expect(deliveries.some((row) => row.event === "intercompany.invoiced")).toBe(true);
    expect(deliveries.some((row) => row.event === "intercompany.settled")).toBe(true);
    expect(deliveries.some((row) => row.event === "qbo.synced")).toBe(true);
  });
});

describe("company books", () => {
  it("keeps each company's ledger and exports it, with QuickBooks left off", async () => {
    delete process.env.ACCOUNTING_PROVIDER;
    const { office, tech, adel } = await seedCompany();
    const service = asActor(office, SERVICE_ENTITY_ID);
    await expect(connectQuickBooks(office)).rejects.toMatchObject({ code: "qbo_disabled" });

    const customer = await createCustomer(office, { brandId: adel.id, name: "Camille Calder" });
    const property = await createProperty(office, customer.data.id, { label: "House", line1: "1 Gulf", city: "Naples", postalCode: "34102" });
    const job = await createJob(office, { customerId: customer.data.id, propertyId: property.data.id, brandId: adel.id, title: "Panel" });
    const invoice = await createInvoice(office, {
      jobId: job.data.id,
      lineItems: [{ kind: "material", description: "LED driver", quantity: "2", unitAmountCents: 4200, taxable: true }],
    });
    await issueInvoice(office, invoice.data.id);
    await recordManualPayment(office, invoice.data.id, { method: "check", amountCents: 4000, reference: "1008" });

    const books = await getBooks(office);
    expect(books.data.openReceivableCents).toBe(4988);
    expect(books.data.aging).toEqual([expect.objectContaining({ customer: "Camille Calder", balanceCents: 4988, bucket: "current" })]);
    expect(books.data.payments).toEqual([expect.objectContaining({ reference: "1008", amountCents: 4000, party: "Camille Calder" })]);
    expect(books.data.revenue.reduce((sum, row) => sum + row.serviceRevenueCents, 0)).toBe(8400);
    const debits = books.data.ledger.reduce((sum, row) => sum + row.debitCents, 0);
    const credits = books.data.ledger.reduce((sum, row) => sum + row.creditCents, 0);
    expect(debits).toBe(credits);
    expect(debits).toBeGreaterThan(0);

    const csv = await exportBooks(office, { report: "ledger", format: "csv" });
    expect(csv.filename).toBe("adel-electric-ledger.csv");
    expect(csv.body.toString("utf8")).toContain("Camille Calder");
    const workbook = await exportBooks(office, { report: "workbook", format: "xlsx" });
    expect(workbook.filename).toBe("adel-electric-books.xlsx");
    expect(workbook.body.subarray(0, 2).toString()).toBe("PK");
    expect(workbook.body.toString("utf8")).toContain("AR aging");
    await expect(exportBooks(office, { report: "workbook", format: "csv" })).rejects.toMatchObject({ code: "invalid_input" });
    expect((await getBooks(service)).data.ledger.some((row) => row.party === "Camille Calder")).toBe(false);

    const rate = await createIntercompanyRate(office, {
      supplyingEntityId: ADEL_ENTITY_ID,
      consumingEntityId: SERVICE_ENTITY_ID,
      kind: "labor",
      name: "Field technician hour",
      unit: "hour",
      unitAmountCents: 9500,
    });
    const hoa = await createCustomer(service, { brandId: SERVICE_BRAND_ID, name: "Palm Court HOA" });
    const hoaProperty = await createProperty(service, hoa.data.id, { label: "House", line1: "9 Dock", city: "Naples", postalCode: "34102" });
    const hoaJob = await createJob(service, {
      customerId: hoa.data.id,
      propertyId: hoaProperty.data.id,
      brandId: SERVICE_BRAND_ID,
      title: "Quarterly lighting check",
    });
    const visit = await scheduleVisit(service, {
      jobId: hoaJob.data.id,
      technicianId: tech.id,
      scheduledStart: "2026-10-20T14:00:00.000Z",
      scheduledEnd: "2026-10-20T16:00:00.000Z",
    });
    await createChargeFromVisit(office, { visitId: visit.data.id, supplyingEntityId: ADEL_ENTITY_ID, rateId: rate.data.id });
    const generated = await generateIntercompanyInvoice(office, { supplyingEntityId: ADEL_ENTITY_ID, consumingEntityId: SERVICE_ENTITY_ID });

    const adelAfter = await getBooks(office);
    expect(adelAfter.data.intercompany.receivableCents).toBe(generated.data.totalCents);
    expect(adelAfter.data.intercompany.payableCents).toBe(0);
    expect(adelAfter.data.ledger.some((row) => row.account === "Intercompany revenue")).toBe(true);
    expect(adelAfter.data.ledger.some((row) => row.account === "Intercompany expense")).toBe(false);
    const serviceAfter = await getBooks(service);
    expect(serviceAfter.data.intercompany.payableCents).toBe(generated.data.totalCents);
    expect(serviceAfter.data.intercompany.receivableCents).toBe(0);
    expect(serviceAfter.data.ledger.some((row) => row.account === "Intercompany expense")).toBe(true);
    expect(serviceAfter.data.ledger.some((row) => row.party === "Camille Calder")).toBe(false);
    const serviceCsv = (await exportBooks(service, { report: "ledger", format: "csv" })).body.toString("utf8");
    expect(serviceCsv).not.toContain("Camille Calder");
    expect(serviceCsv).toContain("Adel Electric");
    const adelAging = (await exportBooks(office, { report: "aging", format: "csv" })).body.toString("utf8");
    expect(adelAging).toContain("Camille Calder");
    expect(adelAging).not.toContain("Palm Court HOA");
  });
});
