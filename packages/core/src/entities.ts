import {
  billPayments,
  bills,
  brands,
  catalogItems,
  contracts,
  customers,
  db,
  entities,
  entityLinks,
  intercompanyCharges,
  intercompanyRates,
  invoices,
  jobs,
  payments,
  properties,
  qboConnections,
  qboMappings,
  quotes,
  requests,
  vendors,
  visits,
  webhookEndpoints,
} from "@adel/db";
import { asc, eq, or } from "drizzle-orm";
import { z } from "zod";
import { AppError, notFound } from "./errors";
import { optionalText, parse } from "./parse";
import { assertOffice, type Actor } from "./permissions";
import { assertActiveBook } from "./scope";

export async function renameEntity(actor: Actor, input: unknown) {
  assertOffice(actor);
  if (actor.role !== "admin") throw new AppError(403, "An administrator has to rename a company.", "forbidden");
  const data = parse(z.object({ name: z.string().trim().min(1).max(160) }), input);
  const [row] = await db
    .update(entities)
    .set({ name: data.name, updatedAt: new Date() })
    .where(eq(entities.id, actor.entityId))
    .returning();
  if (!row) throw notFound("Company not found.");
  return { data: { id: row.id, name: row.name, slug: row.slug } };
}

const contractInput = z.object({
  customerId: z.string().uuid(),
  propertyId: z.string().uuid(),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  status: z.enum(["draft", "active", "ended"]).optional(),
  notes: optionalText,
});

export async function listContracts(actor: Actor) {
  assertOffice(actor);
  const rows = await db
    .select({
      id: contracts.id,
      customerId: contracts.customerId,
      customerName: customers.name,
      propertyId: contracts.propertyId,
      propertyLabel: properties.label,
      startsOn: contracts.startsOn,
      endsOn: contracts.endsOn,
      status: contracts.status,
      notes: contracts.notes,
      entityId: contracts.entityId,
    })
    .from(contracts)
    .innerJoin(customers, eq(customers.id, contracts.customerId))
    .innerJoin(properties, eq(properties.id, contracts.propertyId))
    .where(eq(contracts.entityId, actor.entityId))
    .orderBy(asc(contracts.startsOn));
  return { data: rows };
}

export async function createContract(actor: Actor, input: unknown) {
  assertOffice(actor);
  const data = parse(contractInput, input);
  const [customer] = await db.select().from(customers).where(eq(customers.id, data.customerId));
  if (!customer) throw notFound("Customer not found.");
  assertActiveBook(actor, customer.entityId);
  const [property] = await db.select().from(properties).where(eq(properties.id, data.propertyId));
  if (!property || property.customerId !== customer.id) throw new AppError(400, "That service location is not on this customer.", "property_mismatch");
  assertActiveBook(actor, property.entityId);
  const [row] = await db
    .insert(contracts)
    .values({
      entityId: actor.entityId,
      customerId: customer.id,
      propertyId: property.id,
      startsOn: data.startsOn,
      endsOn: data.endsOn ?? null,
      status: data.status ?? "draft",
      notes: data.notes,
    })
    .returning();
  return { data: row };
}

export async function linkCustomers(actor: Actor, input: unknown) {
  assertOffice(actor);
  const data = parse(
    z.object({
      customerId: z.string().uuid(),
      otherEntityId: z.string().uuid(),
      otherCustomerId: z.string().uuid(),
    }),
    input,
  );
  const [customer] = await db.select().from(customers).where(eq(customers.id, data.customerId));
  if (!customer) throw notFound("Customer not found.");
  assertActiveBook(actor, customer.entityId);
  if (!actor.entityIds.includes(data.otherEntityId) || data.otherEntityId === actor.entityId) {
    throw new AppError(400, "Link the other company's own customer record.", "invalid_input");
  }
  const [other] = await db.select().from(customers).where(eq(customers.id, data.otherCustomerId));
  if (!other || other.entityId !== data.otherEntityId) throw notFound("The other customer was not found in that company.");
  const [row] = await db
    .insert(entityLinks)
    .values({
      kind: "customer",
      fromEntityId: customer.entityId,
      fromRecordId: customer.id,
      toEntityId: other.entityId,
      toRecordId: other.id,
    })
    .returning();
  return {
    data: {
      id: row.id,
      kind: row.kind,
      fromEntityId: row.fromEntityId,
      fromRecordId: row.fromRecordId,
      toEntityId: row.toEntityId,
      toRecordId: row.toRecordId,
    },
  };
}

export async function listEntityLinks(actor: Actor) {
  assertOffice(actor);
  const rows = await db
    .select({
      id: entityLinks.id,
      kind: entityLinks.kind,
      fromEntityId: entityLinks.fromEntityId,
      fromRecordId: entityLinks.fromRecordId,
      toEntityId: entityLinks.toEntityId,
      toRecordId: entityLinks.toRecordId,
    })
    .from(entityLinks)
    .where(or(eq(entityLinks.fromEntityId, actor.entityId), eq(entityLinks.toEntityId, actor.entityId)));
  return { data: rows };
}

export async function exportEntity(actor: Actor) {
  assertOffice(actor);
  const entityId = actor.entityId;
  const [entity] = await db.select().from(entities).where(eq(entities.id, entityId));
  if (!entity) throw notFound("Company not found.");
  const [brandRows, customerRows, propertyRows, requestRows, quoteRows, jobRows, visitRows, invoiceRows, paymentRows, contractRows, webhookRows, linkRows, itemRows, vendorRows, billRows, billPaymentRows, quickbooksRows, mappingRows, rateRows, chargeRows] =
    await Promise.all([
      db.select().from(brands).where(eq(brands.entityId, entityId)),
      db.select().from(customers).where(eq(customers.entityId, entityId)),
      db.select().from(properties).where(eq(properties.entityId, entityId)),
      db.select().from(requests).where(eq(requests.entityId, entityId)),
      db.select().from(quotes).where(eq(quotes.entityId, entityId)),
      db.select().from(jobs).where(eq(jobs.entityId, entityId)),
      db.select().from(visits).where(eq(visits.entityId, entityId)),
      db.select().from(invoices).where(eq(invoices.entityId, entityId)),
      db
        .select({
          id: payments.id,
          invoiceId: payments.invoiceId,
          amountCents: payments.amountCents,
          method: payments.method,
          status: payments.status,
          createdAt: payments.createdAt,
        })
        .from(payments)
        .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
        .where(eq(invoices.entityId, entityId)),
      db.select().from(contracts).where(eq(contracts.entityId, entityId)),
      db
        .select({
          id: webhookEndpoints.id,
          url: webhookEndpoints.url,
          events: webhookEndpoints.events,
          active: webhookEndpoints.active,
        })
        .from(webhookEndpoints)
        .where(eq(webhookEndpoints.entityId, entityId)),
      db
        .select()
        .from(entityLinks)
        .where(or(eq(entityLinks.fromEntityId, entityId), eq(entityLinks.toEntityId, entityId))),
      db.select().from(catalogItems).where(eq(catalogItems.entityId, entityId)),
      db.select().from(vendors).where(eq(vendors.entityId, entityId)),
      db.select().from(bills).where(eq(bills.entityId, entityId)),
      db
        .select({
          id: billPayments.id,
          billId: billPayments.billId,
          amountCents: billPayments.amountCents,
          method: billPayments.method,
          status: billPayments.status,
          reference: billPayments.reference,
          createdAt: billPayments.createdAt,
        })
        .from(billPayments)
        .innerJoin(bills, eq(bills.id, billPayments.billId))
        .where(eq(bills.entityId, entityId)),
      db
        .select({
          id: qboConnections.id,
          environment: qboConnections.environment,
          provider: qboConnections.provider,
          realmId: qboConnections.realmId,
          companyName: qboConnections.companyName,
        })
        .from(qboConnections)
        .where(eq(qboConnections.entityId, entityId)),
      db
        .select({
          id: qboMappings.id,
          resourceType: qboMappings.resourceType,
          resourceId: qboMappings.resourceId,
          realmId: qboMappings.realmId,
          qboId: qboMappings.qboId,
        })
        .from(qboMappings)
        .where(eq(qboMappings.entityId, entityId)),
      db
        .select()
        .from(intercompanyRates)
        .where(or(eq(intercompanyRates.supplyingEntityId, entityId), eq(intercompanyRates.consumingEntityId, entityId))),
      db
        .select()
        .from(intercompanyCharges)
        .where(or(eq(intercompanyCharges.supplyingEntityId, entityId), eq(intercompanyCharges.consumingEntityId, entityId))),
    ]);
  return {
    data: {
      entity: { id: entity.id, name: entity.name, slug: entity.slug, taxRateBps: entity.taxRateBps, taxLabel: entity.taxLabel, stripeAccountId: entity.stripeAccountId },
      brands: brandRows,
      customers: customerRows,
      properties: propertyRows,
      requests: requestRows,
      quotes: quoteRows.map(({ publicToken: _token, ...quote }) => quote),
      jobs: jobRows,
      visits: visitRows.map(({ signaturePng: _png, ...visit }) => visit),
      invoices: invoiceRows,
      payments: paymentRows,
      contracts: contractRows,
      webhooks: webhookRows,
      catalogItems: itemRows,
      vendors: vendorRows,
      bills: billRows,
      billPayments: billPaymentRows,
      quickbooks: quickbooksRows,
      quickbooksMappings: mappingRows,
      intercompanyRates: rateRows,
      intercompanyCharges: chargeRows,
      links: linkRows.map((link) => ({
        id: link.id,
        kind: link.kind,
        fromEntityId: link.fromEntityId,
        fromRecordId: link.fromRecordId,
        toEntityId: link.toEntityId,
        toRecordId: link.toRecordId,
      })),
    },
  };
}
