import {
  brands,
  contractCharges,
  contractEquipment,
  contractProperties,
  contractReminders,
  contractRenewals,
  contractSchedules,
  contracts,
  customers,
  db,
  entities,
  entityLinks,
  invoices,
  jobs,
  payments,
  properties,
  quotes,
  requests,
  scheduleOccurrences,
  visits,
  webhookEndpoints,
} from "@adel/db";
import { eq, or } from "drizzle-orm";
import { z } from "zod";
import { AppError, notFound } from "./errors";
import { parse } from "./parse";
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
  const [brandRows, customerRows, propertyRows, requestRows, quoteRows, jobRows, visitRows, invoiceRows, paymentRows, contractRows, scheduleRows, occurrenceRows, equipmentRows, coveredRows, chargeRows, renewalRows, reminderRows, webhookRows, linkRows] =
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
      db.select().from(contractSchedules).where(eq(contractSchedules.entityId, entityId)),
      db.select().from(scheduleOccurrences).where(eq(scheduleOccurrences.entityId, entityId)),
      db.select().from(contractEquipment).where(eq(contractEquipment.entityId, entityId)),
      db.select().from(contractProperties).where(eq(contractProperties.entityId, entityId)),
      db.select().from(contractCharges).where(eq(contractCharges.entityId, entityId)),
      db.select().from(contractRenewals).where(eq(contractRenewals.entityId, entityId)),
      db.select().from(contractReminders).where(eq(contractReminders.entityId, entityId)),
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
      contractSchedules: scheduleRows,
      scheduleOccurrences: occurrenceRows,
      contractEquipment: equipmentRows,
      contractProperties: coveredRows,
      contractCharges: chargeRows,
      contractRenewals: renewalRows,
      contractReminders: reminderRows,
      webhooks: webhookRows,
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
