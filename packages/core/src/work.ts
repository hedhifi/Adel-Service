import { randomUUID } from "node:crypto";
import { summarizeMoney } from "@adel/db/money";
import { companyToday } from "@adel/db/zoned";
import {
  brands,
  customers,
  db,
  entities,
  formTemplates,
  invoiceLineItems,
  invoices,
  jobs,
  payments,
  properties,
  timeEntries,
  users,
  visitForms,
  visitNotes,
  visitPhotos,
  visits,
  type FormItem,
  type JobStatus,
} from "@adel/db";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { nextNumber, type Tx } from "./db";
import { AppError, notFound } from "./errors";
import { pageSchema, parse } from "./parse";
import { assertOffice, type Actor } from "./permissions";
import { assertActiveBook, assertVisible } from "./scope";
import { assertProperty } from "./records";
import { getCompanySettings } from "./settings";
import { objectStore } from "./storage";
import { emitEvent, safeDeliver } from "./webhooks";

const PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export { uploadRoot } from "./storage";

async function recomputeJob(tx: Tx, jobId: string) {
  const rows = await tx.select().from(visits).where(eq(visits.jobId, jobId));
  let status: JobStatus = "unscheduled";
  if (rows.length === 0) status = "unscheduled";
  else if (rows.every((visit) => visit.status === "canceled")) status = "canceled";
  else if (rows.some((visit) => visit.status === "completed") && rows.filter((visit) => visit.status !== "canceled").every((visit) => visit.status === "completed")) {
    status = "completed";
  } else if (rows.some((visit) => visit.status === "on_site" || visit.status === "en_route" || visit.status === "completed")) {
    status = "in_progress";
  } else if (rows.some((visit) => visit.status === "scheduled")) status = "scheduled";
  await tx.update(jobs).set({ status, updatedAt: new Date() }).where(eq(jobs.id, jobId));
  return status;
}

async function requireTech(tx: Tx, technicianId: string) {
  const [tech] = await tx.select().from(users).where(eq(users.id, technicianId));
  if (!tech || !tech.active || tech.role !== "tech") {
    throw new AppError(400, "Assign an active technician.", "invalid_technician");
  }
  return tech;
}

export async function requireVisit(actor: Actor, visitId: string) {
  const [visit] = await db.select().from(visits).where(eq(visits.id, visitId));
  if (!visit) throw notFound("Visit not found.");
  assertVisible(actor, visit.entityId);
  if (actor.role === "tech" && visit.technicianId !== actor.id) {
    throw new AppError(403, "This visit is assigned to someone else.", "forbidden");
  }
  return visit;
}

async function invoiceBrief(jobId: string) {
  const [invoice] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.jobId, jobId), ne(invoices.status, "void")))
    .orderBy(desc(invoices.createdAt))
    .limit(1);
  if (!invoice) return null;
  const lines = await db.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, invoice.id));
  const summary = summarizeMoney(lines, invoice.taxRateBps);
  const pays = await db.select().from(payments).where(eq(payments.invoiceId, invoice.id));
  const paidCents = pays.filter((payment) => payment.status === "succeeded").reduce((sum, payment) => sum + payment.amountCents, 0);
  return {
    id: invoice.id,
    number: invoice.number,
    status: invoice.status,
    totalCents: summary.totalCents,
    balanceCents: summary.totalCents - paidCents,
  };
}

export async function listJobs(
  actor: Actor,
  query: { status?: string; q?: string; customerId?: string; limit?: unknown; offset?: unknown } = {},
) {
  assertOffice(actor);
  const page = parse(pageSchema, { limit: query.limit ?? 50, offset: query.offset ?? 0 });
  const filters = [eq(jobs.entityId, actor.entityId)];
  if (query.status) {
    const status = parse(z.enum(["unscheduled", "scheduled", "in_progress", "completed", "canceled"]), query.status);
    filters.push(eq(jobs.status, status));
  }
  if (query.customerId) filters.push(eq(jobs.customerId, query.customerId));
  if (query.q?.trim()) filters.push(sql`${jobs.title} ILIKE ${"%" + query.q.trim().replace(/[%_]/g, "") + "%"}`);
  const where = and(...filters);
  const [countRow] = await db.select({ total: sql<number>`count(*)::int` }).from(jobs).where(where);
  const rows = await db
    .select({
      id: jobs.id,
      number: jobs.number,
      title: jobs.title,
      status: jobs.status,
      customerId: jobs.customerId,
      customerName: customers.name,
      brandName: brands.name,
      city: properties.city,
      createdAt: jobs.createdAt,
    })
    .from(jobs)
    .innerJoin(customers, eq(customers.id, jobs.customerId))
    .innerJoin(properties, eq(properties.id, jobs.propertyId))
    .innerJoin(brands, eq(brands.id, jobs.brandId))
    .where(where)
    .orderBy(desc(jobs.createdAt))
    .limit(page.limit)
    .offset(page.offset);
  return { data: rows, total: countRow?.total ?? 0 };
}

export async function getJob(actor: Actor, id: string) {
  assertOffice(actor);
  const [job] = await db
    .select({
      id: jobs.id,
      number: jobs.number,
      title: jobs.title,
      status: jobs.status,
      instructions: jobs.instructions,
      quoteId: jobs.quoteId,
      customerId: jobs.customerId,
      customerName: customers.name,
      customerPhone: customers.phone,
      propertyId: jobs.propertyId,
      propertyLabel: properties.label,
      line1: properties.line1,
      city: properties.city,
      state: properties.state,
      postalCode: properties.postalCode,
      accessNotes: properties.accessNotes,
      brandId: jobs.brandId,
      brandName: brands.name,
      entityId: jobs.entityId,
      entityName: entities.name,
      createdAt: jobs.createdAt,
    })
    .from(jobs)
    .innerJoin(customers, eq(customers.id, jobs.customerId))
    .innerJoin(properties, eq(properties.id, jobs.propertyId))
    .innerJoin(brands, eq(brands.id, jobs.brandId))
    .innerJoin(entities, eq(entities.id, jobs.entityId))
    .where(eq(jobs.id, id));
  if (!job) throw notFound("Job not found.");
  assertVisible(actor, job.entityId);
  const visitRows = await db
    .select({
      id: visits.id,
      status: visits.status,
      scheduledStart: visits.scheduledStart,
      scheduledEnd: visits.scheduledEnd,
      technicianId: visits.technicianId,
      technicianName: users.name,
    })
    .from(visits)
    .leftJoin(users, eq(users.id, visits.technicianId))
    .where(eq(visits.jobId, id))
    .orderBy(asc(visits.scheduledStart));
  const invoice = job.entityId === actor.entityId ? await invoiceBrief(id) : null;
  return { data: { ...job, visits: visitRows, invoice } };
}

export async function createJob(actor: Actor, input: unknown) {
  assertOffice(actor);
  const data = parse(
    z.object({
      customerId: z.string().uuid(),
      propertyId: z.string().uuid(),
      brandId: z.string().uuid(),
      title: z.string().trim().min(1).max(160),
      instructions: z.string().trim().max(5000).optional(),
    }),
    input,
  );
  const id = await db.transaction(async (tx) => {
    const [customer] = await tx.select().from(customers).where(eq(customers.id, data.customerId));
    if (!customer) throw notFound("Customer not found.");
    assertActiveBook(actor, customer.entityId);
    const property = await assertProperty(tx, data.customerId, data.propertyId);
    assertActiveBook(actor, property.entityId);
    const [brand] = await tx.select().from(brands).where(and(eq(brands.id, data.brandId), eq(brands.entityId, actor.entityId)));
    if (!brand) throw new AppError(400, "Unknown brand.", "unknown_brand");
    const number = await nextNumber(tx, actor.entityId, "job");
    const [job] = await tx
      .insert(jobs)
      .values({
        entityId: actor.entityId,
        number,
        customerId: data.customerId,
        propertyId: data.propertyId,
        brandId: data.brandId,
        title: data.title,
        instructions: data.instructions ?? null,
        status: "unscheduled",
      })
      .returning();
    return job.id;
  });
  return getJob(actor, id);
}

export async function updateJob(actor: Actor, id: string, input: unknown) {
  assertOffice(actor);
  const data = parse(
    z.object({
      title: z.string().trim().min(1).max(160).optional(),
      instructions: z.string().trim().max(5000).nullable().optional(),
      status: z.enum(["canceled"]).optional(),
    }),
    input,
  );
  const [existing] = await db.select().from(jobs).where(eq(jobs.id, id));
  if (!existing) throw notFound("Job not found.");
  assertActiveBook(actor, existing.entityId);
  await db
    .update(jobs)
    .set({
      title: data.title ?? existing.title,
      instructions: data.instructions === undefined ? existing.instructions : data.instructions,
      status: data.status ?? existing.status,
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, id));
  return getJob(actor, id);
}

function parseWhen(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new AppError(400, "That time isn't valid.", "invalid_input");
  return date;
}

export async function scheduleVisit(actor: Actor, input: unknown) {
  assertOffice(actor);
  const data = parse(
    z.object({
      jobId: z.string().uuid(),
      technicianId: z.string().uuid().nullable().optional(),
      scheduledStart: z.string().min(1),
      scheduledEnd: z.string().min(1),
      formTemplateId: z.string().uuid().optional(),
    }),
    input,
  );
  const start = parseWhen(data.scheduledStart);
  const end = parseWhen(data.scheduledEnd);
  if (end <= start) throw new AppError(400, "The visit has to end after it starts.", "invalid_input");
  const visitId = await db.transaction(async (tx) => {
    const [job] = await tx.select().from(jobs).where(eq(jobs.id, data.jobId));
    if (!job) throw notFound("Job not found.");
    assertActiveBook(actor, job.entityId);
    if (job.status === "completed") throw new AppError(409, "This job is already complete.", "invalid_state");
    if (data.technicianId) await requireTech(tx, data.technicianId);
    const wasOpen = job.status === "unscheduled" || job.status === "canceled";
    const [visit] = await tx
      .insert(visits)
      .values({
        entityId: job.entityId,
        jobId: job.id,
        technicianId: data.technicianId ?? null,
        scheduledStart: start,
        scheduledEnd: end,
        status: "scheduled",
      })
      .returning();
    if (data.formTemplateId) {
      const [template] = await tx.select().from(formTemplates).where(eq(formTemplates.id, data.formTemplateId));
      if (!template) throw notFound("Form not found.");
      await tx.insert(visitForms).values({
        visitId: visit.id,
        templateId: template.id,
        name: template.name,
        items: template.items,
        responses: template.items.map((item) => ({ itemId: item.id, checked: false, note: "" })),
      });
    }
    const status = await recomputeJob(tx, job.id);
    if (wasOpen && (status === "scheduled" || status === "in_progress")) {
      await emitEvent(tx, "job.scheduled", { jobId: job.id, number: job.number, visitId: visit.id }, job.entityId);
    }
    return visit.id;
  });
  await safeDeliver();
  return getVisit(actor, visitId);
}

export async function listVisits(
  actor: Actor,
  query: { day?: string; technicianId?: string; limit?: unknown; offset?: unknown; board?: boolean } = {},
) {
  const settings = await getCompanySettings();
  const day = query.day ?? companyToday(settings.timeZone);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new AppError(400, "Use a day like 2026-10-16.", "invalid_input");
  const page = parse(pageSchema, { limit: query.limit ?? 100, offset: query.offset ?? 0 });
  const technicianId = actor.role === "tech" ? actor.id : query.technicianId;
  const filters = [
    sql`(${visits.scheduledStart} AT TIME ZONE ${settings.timeZone})::date = ${day}::date`,
    query.board ? inArray(visits.entityId, actor.entityIds) : eq(visits.entityId, actor.entityId),
  ];
  if (technicianId) filters.push(eq(visits.technicianId, technicianId));
  const where = and(...filters);
  const rows = await db
    .select({
      id: visits.id,
      status: visits.status,
      scheduledStart: visits.scheduledStart,
      scheduledEnd: visits.scheduledEnd,
      technicianId: visits.technicianId,
      technicianName: users.name,
      jobId: jobs.id,
      jobNumber: jobs.number,
      jobTitle: jobs.title,
      customerName: customers.name,
      line1: properties.line1,
      city: properties.city,
      brandName: brands.name,
      entityId: visits.entityId,
      entityName: entities.name,
    })
    .from(visits)
    .innerJoin(jobs, eq(jobs.id, visits.jobId))
    .innerJoin(customers, eq(customers.id, jobs.customerId))
    .innerJoin(properties, eq(properties.id, jobs.propertyId))
    .innerJoin(brands, eq(brands.id, jobs.brandId))
    .innerJoin(entities, eq(entities.id, visits.entityId))
    .leftJoin(users, eq(users.id, visits.technicianId))
    .where(where)
    .orderBy(asc(visits.scheduledStart))
    .limit(page.limit)
    .offset(page.offset);
  return { data: rows, day, timeZone: settings.timeZone };
}

export async function getSchedule(actor: Actor, day?: string) {
  assertOffice(actor);
  const settings = await getCompanySettings();
  const date = day ?? companyToday(settings.timeZone);
  const techs = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(and(eq(users.role, "tech"), eq(users.active, true)))
    .orderBy(users.name);
  const board = await listVisits(actor, { day: date, limit: 200, board: actor.auth === "session" });
  return { data: { day: date, timeZone: settings.timeZone, technicians: techs, visits: board.data } };
}

export async function getVisit(actor: Actor, id: string) {
  const visit = await requireVisit(actor, id);
  const [context] = await db
    .select({
      jobId: jobs.id,
      jobNumber: jobs.number,
      jobTitle: jobs.title,
      jobStatus: jobs.status,
      instructions: jobs.instructions,
      customerId: customers.id,
      customerName: customers.name,
      customerPhone: customers.phone,
      customerEmail: customers.email,
      propertyLabel: properties.label,
      line1: properties.line1,
      line2: properties.line2,
      city: properties.city,
      state: properties.state,
      postalCode: properties.postalCode,
      accessNotes: properties.accessNotes,
      brandName: brands.name,
    })
    .from(jobs)
    .innerJoin(customers, eq(customers.id, jobs.customerId))
    .innerJoin(properties, eq(properties.id, jobs.propertyId))
    .innerJoin(brands, eq(brands.id, jobs.brandId))
    .where(eq(jobs.id, visit.jobId));
  const notes = await db
    .select({
      id: visitNotes.id,
      body: visitNotes.body,
      rawBody: visitNotes.rawBody,
      sourceLanguage: visitNotes.sourceLanguage,
      createdAt: visitNotes.createdAt,
      authorName: users.name,
    })
    .from(visitNotes)
    .innerJoin(users, eq(users.id, visitNotes.authorId))
    .where(eq(visitNotes.visitId, id))
    .orderBy(asc(visitNotes.createdAt));
  const photos = await db
    .select({
      id: visitPhotos.id,
      caption: visitPhotos.caption,
      rawCaption: visitPhotos.rawCaption,
      contentType: visitPhotos.contentType,
      createdAt: visitPhotos.createdAt,
    })
    .from(visitPhotos)
    .where(eq(visitPhotos.visitId, id))
    .orderBy(asc(visitPhotos.createdAt));
  const forms = await db.select().from(visitForms).where(eq(visitForms.visitId, id));
  const times = await db.select().from(timeEntries).where(eq(timeEntries.visitId, id)).orderBy(asc(timeEntries.startedAt));
  const [tech] = visit.technicianId ? await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, visit.technicianId)) : [undefined];
  const invoice = await invoiceBrief(visit.jobId);
  return {
    data: {
      id: visit.id,
      status: visit.status,
      scheduledStart: visit.scheduledStart,
      scheduledEnd: visit.scheduledEnd,
      internalNotes: visit.internalNotes,
      technicianId: visit.technicianId,
      technicianName: tech?.name ?? null,
      signedByName: visit.signedByName,
      signedByRaw: visit.signedByRaw,
      signedAt: visit.signedAt,
      hasSignature: Boolean(visit.signaturePng),
      signaturePng: visit.signaturePng,
      completedAt: visit.completedAt,
      ...context,
      notes,
      photos,
      forms,
      timeEntries: times,
      invoice,
    },
  };
}

const nextStatus: Record<string, Array<"en_route" | "on_site" | "canceled">> = {
  scheduled: ["en_route", "on_site", "canceled"],
  en_route: ["on_site", "canceled"],
  on_site: ["canceled"],
};

export async function updateVisit(actor: Actor, id: string, input: unknown) {
  const visit = await requireVisit(actor, id);
  const data = parse(
    z.object({
      technicianId: z.string().uuid().nullable().optional(),
      scheduledStart: z.string().optional(),
      scheduledEnd: z.string().optional(),
      status: z.enum(["en_route", "on_site", "canceled", "completed"]).optional(),
      internalNotes: z.string().trim().max(5000).nullable().optional(),
    }),
    input,
  );
  if (data.status === "completed") return completeVisit(actor, id);
  if (actor.role === "tech" && (data.technicianId !== undefined || data.scheduledStart || data.scheduledEnd || data.internalNotes !== undefined)) {
    if (data.status === undefined) throw new AppError(403, "Ask the office to change the schedule.", "forbidden");
  }
  if (data.status && !nextStatus[visit.status]?.includes(data.status)) {
    throw new AppError(409, "That status change isn't available.", "invalid_state");
  }
  const start = data.scheduledStart ? parseWhen(data.scheduledStart) : visit.scheduledStart;
  const end = data.scheduledEnd ? parseWhen(data.scheduledEnd) : visit.scheduledEnd;
  if (end <= start) throw new AppError(400, "The visit has to end after it starts.", "invalid_input");
  await db.transaction(async (tx) => {
    if (data.technicianId) await requireTech(tx, data.technicianId);
    await tx
      .update(visits)
      .set({
        technicianId: data.technicianId === undefined ? visit.technicianId : data.technicianId,
        scheduledStart: start,
        scheduledEnd: end,
        status: data.status ?? visit.status,
        internalNotes: data.internalNotes === undefined ? visit.internalNotes : data.internalNotes,
        updatedAt: new Date(),
      })
      .where(eq(visits.id, id));
    if (data.status === "en_route" || data.status === "on_site") {
      await tx.update(jobs).set({ status: "in_progress", updatedAt: new Date() }).where(eq(jobs.id, visit.jobId));
    }
    if (data.status === "canceled") await recomputeJob(tx, visit.jobId);
  });
  return getVisit(actor, id);
}

export async function addVisitNote(actor: Actor, visitId: string, input: unknown) {
  await requireVisit(actor, visitId);
  const data = parse(
    z.object({
      body: z.string().trim().min(1).max(5000),
      rawBody: z.string().trim().max(5000).optional().nullable(),
      sourceLanguage: z.enum(["en", "es"]).optional().nullable(),
    }),
    input,
  );
  const [note] = await db
    .insert(visitNotes)
    .values({
      visitId,
      authorId: actor.id,
      body: data.body,
      rawBody: data.rawBody || null,
      sourceLanguage: data.sourceLanguage || null,
    })
    .returning();
  return { data: note };
}

export async function addVisitPhoto(
  actor: Actor,
  visitId: string,
  file: { bytes: Buffer; contentType: string; caption?: string | null; rawCaption?: string | null },
) {
  const visit = await requireVisit(actor, visitId);
  const extension = PHOTO_TYPES[file.contentType];
  if (!extension) throw new AppError(400, "Upload a JPEG, PNG, or WebP photo.", "invalid_file");
  if (file.bytes.length === 0 || file.bytes.length > 8_000_000) {
    throw new AppError(400, "Photos need to be under 8 MB.", "invalid_file");
  }
  const photoId = randomUUID();
  const storageKey = `${visit.id}/${photoId}.${extension}`;
  await objectStore().put(storageKey, file.bytes, file.contentType);
  const [photo] = await db
    .insert(visitPhotos)
    .values({
      id: photoId,
      visitId,
      authorId: actor.id,
      storageKey,
      contentType: file.contentType,
      caption: file.caption?.slice(0, 200) ?? null,
      rawCaption: file.rawCaption?.slice(0, 5000) || null,
    })
    .returning();
  return {
    data: { id: photo.id, caption: photo.caption, rawCaption: photo.rawCaption, contentType: photo.contentType, createdAt: photo.createdAt },
  };
}

export async function readVisitPhoto(actor: Actor, visitId: string, photoId: string) {
  await requireVisit(actor, visitId);
  const [photo] = await db
    .select()
    .from(visitPhotos)
    .where(and(eq(visitPhotos.id, photoId), eq(visitPhotos.visitId, visitId)));
  if (!photo) throw notFound("Photo not found.");
  const bytes = await objectStore().get(photo.storageKey);
  return { bytes, contentType: photo.contentType };
}

export async function saveSignature(actor: Actor, visitId: string, input: unknown) {
  const visit = await requireVisit(actor, visitId);
  if (visit.status === "completed" || visit.status === "canceled") {
    throw new AppError(409, "This visit is already closed.", "invalid_state");
  }
  const data = parse(
    z.object({
      signedByName: z.string().trim().min(1).max(160),
      signedByRaw: z.string().trim().max(160).optional().nullable(),
      signaturePng: z.string().min(30).max(500_000),
    }),
    input,
  );
  if (!data.signaturePng.startsWith("data:image/png;base64,")) {
    throw new AppError(400, "Signature has to be a PNG image.", "invalid_signature");
  }
  await db
    .update(visits)
    .set({
      signaturePng: data.signaturePng,
      signedByName: data.signedByName,
      signedByRaw: data.signedByRaw || null,
      signedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(visits.id, visitId));
  return getVisit(actor, visitId);
}

export async function listFormTemplates(actor: Actor) {
  if (actor.role === "tech") {
    // Technicians can attach a form to their own visit.
  }
  const rows = await db.select().from(formTemplates).where(eq(formTemplates.entityId, actor.entityId)).orderBy(formTemplates.name);
  return { data: rows };
}

export async function addVisitForm(actor: Actor, visitId: string, input: unknown) {
  const visit = await requireVisit(actor, visitId);
  if (visit.status === "completed" || visit.status === "canceled") {
    throw new AppError(409, "This visit is already closed.", "invalid_state");
  }
  const data = parse(z.object({ templateId: z.string().uuid() }), input);
  const [template] = await db.select().from(formTemplates).where(eq(formTemplates.id, data.templateId));
  if (!template) throw notFound("Form not found.");
  const [form] = await db
    .insert(visitForms)
    .values({
      visitId,
      templateId: template.id,
      name: template.name,
      items: template.items,
      responses: template.items.map((item: FormItem) => ({ itemId: item.id, checked: false, note: "" })),
    })
    .returning();
  return { data: form };
}

export async function saveVisitForm(actor: Actor, visitId: string, formId: string, input: unknown) {
  const visit = await requireVisit(actor, visitId);
  if (visit.status === "completed" || visit.status === "canceled") {
    throw new AppError(409, "This visit is already closed.", "invalid_state");
  }
  const data = parse(
    z.object({
      responses: z.array(
        z.object({
          itemId: z.string(),
          checked: z.boolean(),
          note: z.string().max(500).optional(),
          rawNote: z.string().max(5000).optional(),
        }),
      ),
    }),
    input,
  );
  const [form] = await db.select().from(visitForms).where(and(eq(visitForms.id, formId), eq(visitForms.visitId, visitId)));
  if (!form) throw notFound("Form not found.");
  const responses = form.items.map((item) => {
    const incoming = data.responses.find((response) => response.itemId === item.id);
    return {
      itemId: item.id,
      checked: Boolean(incoming?.checked),
      note: incoming?.note?.trim() ?? "",
      rawNote: incoming?.rawNote?.trim() || undefined,
    };
  });
  const [saved] = await db
    .update(visitForms)
    .set({ responses, updatedAt: new Date() })
    .where(eq(visitForms.id, formId))
    .returning();
  return { data: saved };
}

export async function clockVisit(actor: Actor, visitId: string, input: unknown) {
  const visit = await requireVisit(actor, visitId);
  if (visit.status === "completed" || visit.status === "canceled") {
    throw new AppError(409, "This visit is already closed.", "invalid_state");
  }
  const data = parse(
    z.object({
      action: z.enum(["in", "out"]),
      note: z.string().trim().max(300).optional(),
      rawNote: z.string().trim().max(5000).optional(),
    }),
    input,
  );
  if (data.action === "in") {
    const [open] = await db
      .select()
      .from(timeEntries)
      .where(and(eq(timeEntries.visitId, visitId), eq(timeEntries.userId, actor.id), isNull(timeEntries.endedAt)));
    if (open) throw new AppError(409, "You're already clocked in on this visit.", "already_clocked_in");
    await db.insert(timeEntries).values({
      visitId,
      userId: actor.id,
      startedAt: new Date(),
      note: data.note || null,
      rawNote: data.rawNote || null,
    });
    if (visit.status === "scheduled" || visit.status === "en_route") {
      await db.transaction(async (tx) => {
        await tx.update(visits).set({ status: "on_site", updatedAt: new Date() }).where(eq(visits.id, visitId));
        await tx.update(jobs).set({ status: "in_progress", updatedAt: new Date() }).where(eq(jobs.id, visit.jobId));
      });
    }
  } else {
    const [open] = await db
      .select()
      .from(timeEntries)
      .where(and(eq(timeEntries.visitId, visitId), eq(timeEntries.userId, actor.id), isNull(timeEntries.endedAt)));
    if (!open) throw new AppError(409, "You're not clocked in on this visit.", "not_clocked_in");
    await db.update(timeEntries).set({ endedAt: new Date(), note: data.note || open.note, rawNote: data.rawNote || open.rawNote }).where(eq(timeEntries.id, open.id));
  }
  return getVisit(actor, visitId);
}

export async function completeVisit(actor: Actor, visitId: string) {
  const visit = await requireVisit(actor, visitId);
  if (visit.status === "completed") return getVisit(actor, visitId);
  if (visit.status === "canceled") throw new AppError(409, "This visit was canceled.", "invalid_state");
  const settings = await getCompanySettings();
  const privileged = actor.role === "admin" || actor.role === "office";
  if (!privileged && settings.requireSignatureToComplete && (!visit.signaturePng || !visit.signedByName)) {
    throw new AppError(400, "Capture the customer's signature before completing this visit.", "signature_required");
  }
  if (!privileged) {
    const forms = await db.select().from(visitForms).where(eq(visitForms.visitId, visitId));
    for (const form of forms) {
      for (const item of form.items) {
        if (!item.required) continue;
        const response = form.responses.find((entry) => entry.itemId === item.id);
        if (!response?.checked) {
          throw new AppError(400, `Check "${item.label}" on ${form.name} before completing.`, "form_incomplete");
        }
      }
    }
  }
  await db.transaction(async (tx) => {
    const completedAt = new Date();
    await tx
      .update(visits)
      .set({ status: "completed", completedAt, updatedAt: completedAt })
      .where(eq(visits.id, visitId));
    await tx
      .update(timeEntries)
      .set({ endedAt: completedAt })
      .where(and(eq(timeEntries.visitId, visitId), isNull(timeEntries.endedAt)));
    await recomputeJob(tx, visit.jobId);
    await emitEvent(tx, "visit.completed", {
      visitId,
      jobId: visit.jobId,
      technicianId: visit.technicianId,
      completedAt: completedAt.toISOString(),
    }, visit.entityId);
  });
  await safeDeliver();
  return getVisit(actor, visitId);
}
