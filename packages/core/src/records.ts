import {
  brands,
  customers,
  db,
  jobs,
  properties,
  quotes,
  requests,
  visits,
} from "@adel/db";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "./db";
import { AppError, notFound } from "./errors";
import { isUniqueViolation, optionalText, pageSchema, parse } from "./parse";
import { assertOffice, type Actor } from "./permissions";
import { emitEvent, safeDeliver } from "./webhooks";

const customerInput = z.object({
  brandId: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
  email: z.string().trim().email().optional().nullable().or(z.literal("")).transform((value) => value || null),
  phone: optionalText,
  notes: optionalText,
});

const propertyInput = z.object({
  label: z.string().trim().min(1).max(120),
  line1: z.string().trim().min(1).max(160),
  line2: optionalText,
  city: z.string().trim().min(1).max(80),
  state: z.string().trim().length(2).optional(),
  postalCode: z.string().trim().min(5).max(10),
  accessNotes: optionalText,
});

function likeTerm(value: string) {
  return `%${value.replace(/[%_]/g, "")}%`;
}

async function requireBrand(tx: Tx, brandId: string) {
  const [brand] = await tx.select().from(brands).where(eq(brands.id, brandId));
  if (!brand) throw new AppError(400, "Unknown brand.", "unknown_brand");
  return brand;
}

export async function assertProperty(tx: Tx, customerId: string, propertyId: string) {
  const [property] = await tx.select().from(properties).where(eq(properties.id, propertyId));
  if (!property || property.customerId !== customerId) {
    throw new AppError(400, "That service location is not on this customer.", "property_mismatch");
  }
  return property;
}

async function techCanSeeCustomer(actor: Actor, customerId: string) {
  const [row] = await db
    .select({ id: visits.id })
    .from(visits)
    .innerJoin(jobs, eq(jobs.id, visits.jobId))
    .where(and(eq(visits.technicianId, actor.id), eq(jobs.customerId, customerId)))
    .limit(1);
  return Boolean(row);
}

export async function listCustomers(actor: Actor, query: { q?: string; limit?: unknown; offset?: unknown } = {}) {
  assertOffice(actor);
  const page = parse(pageSchema, { limit: query.limit ?? 50, offset: query.offset ?? 0 });
  const term = query.q?.trim();
  const where = term
    ? or(ilike(customers.name, likeTerm(term)), ilike(customers.email, likeTerm(term)), ilike(customers.phone, likeTerm(term)))
    : undefined;
  const [countRow] = await db.select({ total: sql<number>`count(*)::int` }).from(customers).where(where);
  const rows = await db
    .select({
      id: customers.id,
      name: customers.name,
      email: customers.email,
      phone: customers.phone,
      notes: customers.notes,
      brandId: customers.brandId,
      brandName: brands.name,
      createdAt: customers.createdAt,
    })
    .from(customers)
    .innerJoin(brands, eq(brands.id, customers.brandId))
    .where(where)
    .orderBy(customers.name)
    .limit(page.limit)
    .offset(page.offset);
  return { data: rows, total: countRow?.total ?? 0 };
}

export async function getCustomer(actor: Actor, id: string) {
  if (actor.role === "tech" && !(await techCanSeeCustomer(actor, id))) {
    throw new AppError(403, "That customer isn't on one of your visits.", "forbidden");
  }
  const [customer] = await db
    .select({
      id: customers.id,
      name: customers.name,
      email: customers.email,
      phone: customers.phone,
      notes: customers.notes,
      brandId: customers.brandId,
      brandName: brands.name,
      createdAt: customers.createdAt,
      updatedAt: customers.updatedAt,
    })
    .from(customers)
    .innerJoin(brands, eq(brands.id, customers.brandId))
    .where(eq(customers.id, id));
  if (!customer) throw notFound("Customer not found.");
  const locationRows = await db.select().from(properties).where(eq(properties.customerId, id)).orderBy(properties.label);
  return { data: { ...customer, properties: locationRows } };
}

export async function createCustomer(actor: Actor, input: unknown) {
  assertOffice(actor);
  const data = parse(customerInput, input);
  return db.transaction(async (tx) => {
    await requireBrand(tx, data.brandId);
    try {
      const [row] = await tx.insert(customers).values(data).returning();
      const [brand] = await tx.select().from(brands).where(eq(brands.id, row.brandId));
      return { data: { ...row, brandName: brand?.name ?? null, properties: [] } };
    } catch (err) {
      if (isUniqueViolation(err)) throw new AppError(409, "Could not save that customer.", "conflict");
      throw err;
    }
  });
}

export async function updateCustomer(actor: Actor, id: string, input: unknown) {
  assertOffice(actor);
  const data = parse(customerInput.partial(), input);
  const [existing] = await db.select().from(customers).where(eq(customers.id, id));
  if (!existing) throw notFound("Customer not found.");
  if (data.brandId) await requireBrand(db as unknown as Tx, data.brandId);
  const [row] = await db
    .update(customers)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(customers.id, id))
    .returning();
  return getCustomer(actor, row.id);
}

export async function createProperty(actor: Actor, customerId: string, input: unknown) {
  assertOffice(actor);
  const data = parse(propertyInput, input);
  const [customer] = await db.select().from(customers).where(eq(customers.id, customerId));
  if (!customer) throw notFound("Customer not found.");
  const [row] = await db
    .insert(properties)
    .values({ ...data, state: (data.state ?? "FL").toUpperCase(), customerId })
    .returning();
  return { data: row };
}

export async function updateProperty(actor: Actor, propertyId: string, input: unknown) {
  assertOffice(actor);
  const data = parse(propertyInput.partial(), input);
  const [existing] = await db.select().from(properties).where(eq(properties.id, propertyId));
  if (!existing) throw notFound("Service location not found.");
  const [row] = await db
    .update(properties)
    .set({
      ...data,
      state: data.state ? data.state.toUpperCase() : undefined,
    })
    .where(eq(properties.id, propertyId))
    .returning();
  return { data: row };
}

const requestInput = z.object({
  customerId: z.string().uuid(),
  propertyId: z.string().uuid(),
  brandId: z.string().uuid(),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(5000),
  source: z.enum(["phone", "email", "in_person", "web", "other"]).default("phone"),
});

export async function listRequests(
  actor: Actor,
  query: { status?: string; q?: string; customerId?: string; limit?: unknown; offset?: unknown } = {},
) {
  assertOffice(actor);
  const page = parse(pageSchema, { limit: query.limit ?? 50, offset: query.offset ?? 0 });
  const filters = [];
  if (query.status) {
    const status = parse(z.enum(["new", "reviewing", "quoted", "closed", "canceled"]), query.status);
    filters.push(eq(requests.status, status));
  }
  if (query.customerId) filters.push(eq(requests.customerId, query.customerId));
  if (query.q?.trim()) filters.push(ilike(requests.title, likeTerm(query.q.trim())));
  const where = filters.length ? and(...filters) : undefined;
  const [countRow] = await db.select({ total: sql<number>`count(*)::int` }).from(requests).where(where);
  const rows = await db
    .select({
      id: requests.id,
      title: requests.title,
      status: requests.status,
      source: requests.source,
      customerId: requests.customerId,
      customerName: customers.name,
      propertyId: requests.propertyId,
      city: properties.city,
      brandId: requests.brandId,
      brandName: brands.name,
      createdAt: requests.createdAt,
    })
    .from(requests)
    .innerJoin(customers, eq(customers.id, requests.customerId))
    .innerJoin(properties, eq(properties.id, requests.propertyId))
    .innerJoin(brands, eq(brands.id, requests.brandId))
    .where(where)
    .orderBy(desc(requests.createdAt))
    .limit(page.limit)
    .offset(page.offset);
  return { data: rows, total: countRow?.total ?? 0 };
}

export async function getRequest(actor: Actor, id: string) {
  assertOffice(actor);
  const [row] = await db
    .select({
      id: requests.id,
      title: requests.title,
      description: requests.description,
      status: requests.status,
      source: requests.source,
      customerId: requests.customerId,
      customerName: customers.name,
      propertyId: requests.propertyId,
      propertyLabel: properties.label,
      line1: properties.line1,
      city: properties.city,
      state: properties.state,
      postalCode: properties.postalCode,
      brandId: requests.brandId,
      brandName: brands.name,
      createdAt: requests.createdAt,
      updatedAt: requests.updatedAt,
    })
    .from(requests)
    .innerJoin(customers, eq(customers.id, requests.customerId))
    .innerJoin(properties, eq(properties.id, requests.propertyId))
    .innerJoin(brands, eq(brands.id, requests.brandId))
    .where(eq(requests.id, id));
  if (!row) throw notFound("Request not found.");
  const relatedQuotes = await db
    .select({ id: quotes.id, number: quotes.number, status: quotes.status, title: quotes.title })
    .from(quotes)
    .where(eq(quotes.requestId, id));
  return { data: { ...row, quotes: relatedQuotes } };
}

export async function createRequest(actor: Actor, input: unknown) {
  assertOffice(actor);
  const data = parse(requestInput, input);
  const created = await db.transaction(async (tx) => {
    await requireBrand(tx, data.brandId);
    const [customer] = await tx.select().from(customers).where(eq(customers.id, data.customerId));
    if (!customer) throw notFound("Customer not found.");
    await assertProperty(tx, data.customerId, data.propertyId);
    const [row] = await tx
      .insert(requests)
      .values({ ...data, createdById: actor.id })
      .returning();
    await emitEvent(tx, "request.created", {
      requestId: row.id,
      customerId: row.customerId,
      propertyId: row.propertyId,
      brandId: row.brandId,
      title: row.title,
      status: row.status,
    });
    return row;
  });
  await safeDeliver();
  return getRequest(actor, created.id);
}

export async function updateRequest(actor: Actor, id: string, input: unknown) {
  assertOffice(actor);
  const data = parse(
    z.object({
      status: z.enum(["new", "reviewing", "quoted", "closed", "canceled"]).optional(),
      title: z.string().trim().min(1).max(160).optional(),
      description: z.string().trim().min(1).max(5000).optional(),
    }),
    input,
  );
  const [existing] = await db.select().from(requests).where(eq(requests.id, id));
  if (!existing) throw notFound("Request not found.");
  await db.update(requests).set({ ...data, updatedAt: new Date() }).where(eq(requests.id, id));
  return getRequest(actor, id);
}
