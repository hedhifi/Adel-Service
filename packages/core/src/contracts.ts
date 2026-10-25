import { addMonths, companyToday, shiftDay, zonedDateTime } from "@adel/db/zoned";
import {
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
  entityMemberships,
  invoiceLineItems,
  invoices,
  jobs,
  notifications,
  properties,
  scheduleOccurrences,
  users,
  visits,
  type JobStatus,
} from "@adel/db";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { stripeSecretKey } from "./billing";
import {
  billingMonths,
  daysBetween,
  occurrenceDate,
  shiftOffHoliday,
  type IntervalUnit,
  type NamedFrequency,
} from "./contract-dates";
import { nextNumber, type Tx } from "./db";
import { AppError, notFound } from "./errors";
import { optionalText, parse } from "./parse";
import { assertOffice, type Actor } from "./permissions";
import { assertActiveBook } from "./scope";
import { getCompanySettings } from "./settings";
import { emitEvent, safeDeliver } from "./webhooks";

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const frequencySchema = z.enum(["monthly", "quarterly", "annual", "custom"]);

const equipmentSchema = z.object({
  name: z.string().trim().min(1).max(160),
  propertyId: z.string().uuid().nullable().optional(),
  location: z.string().trim().max(160).nullable().optional(),
  serial: z.string().trim().max(80).nullable().optional(),
  notes: optionalText,
});

const scheduleSchema = z.object({
  frequency: frequencySchema,
  intervalCount: z.number().int().min(1).max(52).optional(),
  intervalUnit: z.enum(["day", "week", "month"]).optional(),
  anchorOn: daySchema,
  localStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  durationMinutes: z.number().int().min(15).max(480).optional(),
  technicianId: z.string().uuid().nullable().optional(),
  horizonDays: z.number().int().min(7).max(366).optional(),
  title: z.string().trim().min(1).max(160),
  instructions: optionalText,
  active: z.boolean().optional(),
});

type ScheduleInput = z.infer<typeof scheduleSchema>;
type ContractRow = typeof contracts.$inferSelect;
type Bucket = {
  renewed: string[];
  lapsed: string[];
  reminded: string[];
  invoiceIds: string[];
  chargeIds: string[];
  visitsCreated: number;
};

type StripeMirror = {
  customers: {
    create: (args: { name: string; email?: string; metadata: Record<string, string> }) => Promise<{ id: string }>;
  };
  invoices: {
    create: (args: Record<string, unknown>) => Promise<{ id: string }>;
    finalizeInvoice: (id: string) => Promise<{ id: string }>;
  };
  invoiceItems: {
    create: (args: { customer: string; invoice: string; amount: number; currency: string; description: string }) => Promise<unknown>;
  };
};

export type MaintainOptions = {
  stripe?: StripeMirror;
  onlyContractId?: string;
};

function cleanTime(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
    throw new AppError(400, "Use a start time like 09:30.", "invalid_input");
  }
  return value;
}

function assertTerm(startsOn: string, endsOn: string | null | undefined) {
  if (endsOn && endsOn < startsOn) throw new AppError(400, "The contract has to end on or after it starts.", "invalid_input");
}

function scheduleValues(input: ScheduleInput) {
  return {
    frequency: input.frequency,
    intervalCount: input.intervalCount ?? 1,
    intervalUnit: input.intervalUnit ?? "month",
    anchorOn: input.anchorOn,
    localStart: cleanTime(input.localStart ?? "09:00"),
    durationMinutes: input.durationMinutes ?? 60,
    technicianId: input.technicianId ?? null,
    horizonDays: input.horizonDays ?? 90,
    title: input.title,
    instructions: input.instructions ?? null,
    active: input.active ?? true,
  };
}

async function requireContract(actor: Actor, id: string) {
  const [row] = await db.select().from(contracts).where(eq(contracts.id, id));
  if (!row) throw notFound("Contract not found.");
  assertActiveBook(actor, row.entityId);
  return row;
}

async function customerProperties(customerId: string, entityId: string) {
  return db
    .select()
    .from(properties)
    .where(and(eq(properties.customerId, customerId), eq(properties.entityId, entityId)));
}

function coveredIds(primary: string, extra: string[] | undefined) {
  return [...new Set([primary, ...(extra ?? [])])];
}

async function assertCovered(customerId: string, entityId: string, ids: string[]) {
  const rows = await customerProperties(customerId, entityId);
  const known = new Set(rows.map((row) => row.id));
  if (ids.some((id) => !known.has(id))) {
    throw new AppError(400, "Covered locations have to belong to this customer.", "property_mismatch");
  }
  return rows;
}

async function assertTech(technicianId: string | null) {
  if (!technicianId) return;
  const [tech] = await db.select().from(users).where(eq(users.id, technicianId));
  if (!tech || !tech.active || tech.role !== "tech") {
    throw new AppError(400, "Assign an active technician.", "invalid_technician");
  }
}

async function readContract(tx: Tx, id: string) {
  const [row] = await tx.select().from(contracts).where(eq(contracts.id, id));
  if (!row) throw notFound("Contract not found.");
  return row;
}

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

function sameInstant(left: Date | null, right: Date | null) {
  if (!left || !right) return false;
  return Math.abs(left.getTime() - right.getTime()) < 1000;
}

function manuallyAdjusted(
  occurrence: typeof scheduleOccurrences.$inferSelect,
  visit: typeof visits.$inferSelect,
) {
  if (occurrence.pinned) return true;
  if (!occurrence.generatedStart || !occurrence.generatedEnd) return false;
  const techMoved = (visit.technicianId ?? null) !== (occurrence.generatedTechnicianId ?? null);
  return !sameInstant(visit.scheduledStart, occurrence.generatedStart) || !sameInstant(visit.scheduledEnd, occurrence.generatedEnd) || techMoved;
}

async function releaseFutureVisits(
  tx: Tx,
  contractId: string,
  today: string,
  now: Date,
  mode: "lapse" | "cancel",
  endsOn: string | null,
) {
  const schedules = await tx.select().from(contractSchedules).where(eq(contractSchedules.contractId, contractId));
  const jobIds = new Set<string>();
  for (const schedule of schedules) {
    const occurrences = await tx.select().from(scheduleOccurrences).where(eq(scheduleOccurrences.scheduleId, schedule.id));
    for (const occurrence of occurrences) {
      if (occurrence.occursOn < today) continue;
      if (mode === "lapse" && endsOn && occurrence.originalOn <= endsOn) continue;
      const visit = occurrence.visitId ? (await tx.select().from(visits).where(eq(visits.id, occurrence.visitId)))[0] : undefined;
      if (visit && visit.status !== "scheduled") continue;
      if (visit) {
        await tx.update(visits).set({ status: "canceled", updatedAt: now }).where(eq(visits.id, visit.id));
        jobIds.add(visit.jobId);
      }
      if (mode === "lapse" && !occurrence.pinned && occurrence.status !== "skipped") {
        await tx.delete(scheduleOccurrences).where(eq(scheduleOccurrences.id, occurrence.id));
      } else {
        await tx
          .update(scheduleOccurrences)
          .set({
            status: "skipped",
            pinned: true,
            skipReason: mode === "cancel" ? "Contract canceled." : "Outside the contract term.",
          })
          .where(eq(scheduleOccurrences.id, occurrence.id));
      }
    }
  }
  for (const jobId of jobIds) await recomputeJob(tx, jobId);
}

async function ensureJob(tx: Tx, contract: ContractRow, brandId: string) {
  const title = contract.title || "Service contract";
  const instructions = [contract.scope, contract.notes].filter(Boolean).join("\n\n") || null;
  if (contract.jobId) {
    await tx
      .update(jobs)
      .set({ title, propertyId: contract.propertyId, instructions, updatedAt: new Date() })
      .where(eq(jobs.id, contract.jobId));
    return contract.jobId;
  }
  const number = await nextNumber(tx, contract.entityId, "job");
  const [job] = await tx
    .insert(jobs)
    .values({
      entityId: contract.entityId,
      number,
      customerId: contract.customerId,
      propertyId: contract.propertyId,
      brandId,
      title,
      status: "unscheduled",
      instructions,
    })
    .returning();
  await tx.update(contracts).set({ jobId: job.id, updatedAt: new Date() }).where(eq(contracts.id, contract.id));
  return job.id;
}

async function syncSchedules(tx: Tx, contract: ContractRow, today: string, now: Date, timeZone: string, bucket: Bucket) {
  if (contract.status !== "active") return;
  const [customer] = await tx.select().from(customers).where(eq(customers.id, contract.customerId));
  if (!customer) return;
  const schedules = await tx.select().from(contractSchedules).where(eq(contractSchedules.contractId, contract.id));
  let jobId = contract.jobId;
  let announceJob = false;
  if (jobId) {
    const [job] = await tx.select().from(jobs).where(eq(jobs.id, jobId));
    announceJob = job?.status === "unscheduled" || job?.status === "canceled";
  }

  for (const schedule of schedules) {
    const existing = await tx.select().from(scheduleOccurrences).where(eq(scheduleOccurrences.scheduleId, schedule.id));
    const skipped = new Set(existing.filter((row) => row.status === "skipped").map((row) => row.originalOn));
    const horizonEnd = shiftDay(today, schedule.horizonDays);
    const endCap = contract.endsOn && contract.endsOn < horizonEnd ? contract.endsOn : horizonEnd;
    const desired = new Set<string>();
    if (schedule.active) {
      for (let index = 0; index < 500; index += 1) {
        const original = occurrenceDate(
          schedule.anchorOn,
          index,
          schedule.frequency as NamedFrequency,
          schedule.intervalCount,
          schedule.intervalUnit as IntervalUnit,
        );
        if (original > endCap) break;
        if (original < today || original < schedule.anchorOn || skipped.has(original)) continue;
        desired.add(original);
      }
    }

    const visitIds = existing.map((row) => row.visitId).filter((id): id is string => Boolean(id));
    const visitRows = visitIds.length ? await tx.select().from(visits).where(inArray(visits.id, visitIds)) : [];
    const visitById = new Map(visitRows.map((visit) => [visit.id, visit]));
    const removed = new Set<string>();

    for (const occurrence of existing) {
      if (occurrence.status === "skipped") continue;
      const visit = occurrence.visitId ? visitById.get(occurrence.visitId) : undefined;
      if (visit && visit.status === "canceled") {
        await tx
          .update(scheduleOccurrences)
          .set({ status: "skipped", pinned: true, skipReason: occurrence.skipReason ?? "Visit canceled." })
          .where(eq(scheduleOccurrences.id, occurrence.id));
        continue;
      }
      if (visit && visit.status !== "scheduled") continue;
      if (!desired.has(occurrence.originalOn)) {
        if (occurrence.originalOn < today || occurrence.pinned) continue;
        if (visit) {
          await tx.update(visits).set({ status: "canceled", updatedAt: now }).where(eq(visits.id, visit.id));
        }
        await tx.delete(scheduleOccurrences).where(eq(scheduleOccurrences.id, occurrence.id));
        removed.add(occurrence.originalOn);
        continue;
      }
      const shifted = shiftOffHoliday(occurrence.originalOn);
      const start = zonedDateTime(shifted.occursOn, schedule.localStart, timeZone);
      const end = new Date(start.getTime() + schedule.durationMinutes * 60_000);
      if (visit && manuallyAdjusted(occurrence, visit)) {
        await tx.update(scheduleOccurrences).set({ pinned: true }).where(eq(scheduleOccurrences.id, occurrence.id));
        continue;
      }
      if (visit) {
        await tx
          .update(visits)
          .set({
            scheduledStart: start,
            scheduledEnd: end,
            technicianId: schedule.technicianId,
            updatedAt: now,
          })
          .where(eq(visits.id, visit.id));
      }
      await tx
        .update(scheduleOccurrences)
        .set({
          occursOn: shifted.occursOn,
          status: shifted.shifted ? "shifted" : "scheduled",
          generatedStart: start,
          generatedEnd: end,
          generatedTechnicianId: schedule.technicianId,
        })
        .where(eq(scheduleOccurrences.id, occurrence.id));
    }

    const present = new Set(existing.filter((row) => !removed.has(row.originalOn)).map((row) => row.originalOn));
    for (const original of desired) {
      if (present.has(original)) continue;
      const shifted = shiftOffHoliday(original);
      const start = zonedDateTime(shifted.occursOn, schedule.localStart, timeZone);
      const end = new Date(start.getTime() + schedule.durationMinutes * 60_000);
      if (!jobId) {
        jobId = await ensureJob(tx, { ...contract, jobId }, customer.brandId);
        announceJob = true;
      }
      const [visit] = await tx
        .insert(visits)
        .values({
          entityId: contract.entityId,
          jobId,
          technicianId: schedule.technicianId,
          scheduledStart: start,
          scheduledEnd: end,
          status: "scheduled",
          internalNotes: schedule.instructions ? `${schedule.title}. ${schedule.instructions}` : schedule.title,
        })
        .returning();
      const [occurrence] = await tx
        .insert(scheduleOccurrences)
        .values({
          entityId: contract.entityId,
          scheduleId: schedule.id,
          originalOn: original,
          occursOn: shifted.occursOn,
          visitId: visit.id,
          status: shifted.shifted ? "shifted" : "scheduled",
          generatedStart: start,
          generatedEnd: end,
          generatedTechnicianId: schedule.technicianId,
        })
        .returning();
      bucket.visitsCreated += 1;
      await emitEvent(
        tx,
        "contract.visit_scheduled",
        {
          contractId: contract.id,
          scheduleId: schedule.id,
          occurrenceId: occurrence.id,
          visitId: visit.id,
          originalOn: original,
          occursOn: shifted.occursOn,
        },
        contract.entityId,
      );
      if (announceJob) {
        const [job] = await tx.select().from(jobs).where(eq(jobs.id, jobId));
        await emitEvent(
          tx,
          "job.scheduled",
          { jobId, number: job?.number, visitId: visit.id, contractId: contract.id },
          contract.entityId,
        );
        announceJob = false;
      }
    }
  }

  if (jobId) {
    if (contract.jobId) await ensureJob(tx, contract, customer.brandId);
    await recomputeJob(tx, jobId);
  }
}

async function billDue(tx: Tx, contract: ContractRow, today: string, now: Date, bucket: Bucket) {
  if (contract.status !== "active" || contract.priceCents <= 0) return contract;
  const [customer] = await tx.select().from(customers).where(eq(customers.id, contract.customerId));
  const [entity] = await tx.select().from(entities).where(eq(entities.id, contract.entityId));
  if (!customer || !entity) return contract;
  const months = Math.max(1, billingMonths(contract.billingFrequency, contract.billingIntervalCount));
  let cursor = contract.nextBillOn ?? contract.startsOn;
  let guard = 0;
  while (cursor <= today && (!contract.endsOn || cursor < contract.endsOn) && guard < 36) {
    const nextCursor = addMonths(cursor, months);
    const periodEnd = shiftDay(nextCursor, -1);
    const [existing] = await tx
      .select()
      .from(contractCharges)
      .where(and(eq(contractCharges.contractId, contract.id), eq(contractCharges.periodStart, cursor)));
    if (!existing) {
      const number = await nextNumber(tx, contract.entityId, "invoice");
      const description = `${contract.title || "Service contract"} (${cursor} to ${periodEnd})`;
      const [invoice] = await tx
        .insert(invoices)
        .values({
          entityId: contract.entityId,
          number,
          contractId: contract.id,
          customerId: contract.customerId,
          brandId: customer.brandId,
          status: "issued",
          taxRateBps: entity.taxRateBps,
          issuedAt: now,
          dueAt: new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000),
          notes: "Flat fee for included contract work. Labor on this invoice is not taxed.",
        })
        .returning();
      await tx.insert(invoiceLineItems).values({
        invoiceId: invoice.id,
        position: 0,
        kind: "labor",
        description,
        quantity: "1.00",
        unitAmountCents: contract.priceCents,
        taxable: false,
      });
      const [charge] = await tx
        .insert(contractCharges)
        .values({
          entityId: contract.entityId,
          contractId: contract.id,
          periodStart: cursor,
          periodEnd,
          amountCents: contract.priceCents,
          invoiceId: invoice.id,
        })
        .returning();
      bucket.invoiceIds.push(invoice.id);
      bucket.chargeIds.push(charge.id);
      await emitEvent(
        tx,
        "invoice.issued",
        {
          invoiceId: invoice.id,
          number: invoice.number,
          customerId: contract.customerId,
          totalCents: contract.priceCents,
          contractId: contract.id,
        },
        contract.entityId,
      );
    }
    cursor = nextCursor;
    guard += 1;
  }
  await tx.update(contracts).set({ nextBillOn: cursor, updatedAt: now }).where(eq(contracts.id, contract.id));
  return { ...contract, nextBillOn: cursor };
}

async function remind(tx: Tx, contract: ContractRow, today: string, bucket: Bucket) {
  if (contract.status !== "active" || !contract.endsOn) return;
  const daysLeft = daysBetween(today, contract.endsOn);
  if (daysLeft < 0 || daysLeft > contract.reminderDays) return;
  const [existing] = await tx
    .select()
    .from(contractReminders)
    .where(and(eq(contractReminders.contractId, contract.id), eq(contractReminders.endsOn, contract.endsOn)));
  if (existing) return;
  await tx.insert(contractReminders).values({
    entityId: contract.entityId,
    contractId: contract.id,
    endsOn: contract.endsOn,
  });
  const [customer] = await tx.select().from(customers).where(eq(customers.id, contract.customerId));
  const label = contract.title || "Service contract";
  const body = contract.autoRenew
    ? `${customer?.name ?? "A customer"}: ${label} renews on its own on ${contract.endsOn}.`
    : `${customer?.name ?? "A customer"}: ${label} ends ${contract.endsOn}. Renew it, or it lapses.`;
  const members = await tx
    .select()
    .from(entityMemberships)
    .where(eq(entityMemberships.entityId, contract.entityId));
  for (const member of members) {
    if (member.role === "tech") continue;
    await tx.insert(notifications).values({
      userId: member.userId,
      body,
      href: `/contracts/${contract.id}`,
      pushStatus: "unavailable",
    });
  }
  await emitEvent(
    tx,
    "contract.renewal_due",
    {
      contractId: contract.id,
      customerId: contract.customerId,
      endsOn: contract.endsOn,
      priceCents: contract.priceCents,
      autoRenew: contract.autoRenew,
      daysLeft,
    },
    contract.entityId,
  );
  bucket.reminded.push(contract.id);
}

async function renewRow(
  tx: Tx,
  actor: Actor,
  contract: ContractRow,
  source: "manual" | "auto",
  today: string,
  priceCents: number,
  termMonths: number,
  bucket?: Bucket,
) {
  const previousEndsOn = contract.endsOn;
  const base = source === "auto" ? contract.endsOn ?? today : contract.endsOn && contract.endsOn > today ? contract.endsOn : today;
  const newEndsOn = addMonths(base, termMonths);
  const nextBillOn =
    source === "manual" && contract.status === "lapsed" ? (contract.nextBillOn && contract.nextBillOn > today ? contract.nextBillOn : today) : contract.nextBillOn;
  await tx
    .update(contracts)
    .set({
      endsOn: newEndsOn,
      priceCents,
      status: "active",
      lapsedAt: null,
      autoRenew: contract.autoRenew,
      nextBillOn,
      updatedAt: new Date(),
    })
    .where(eq(contracts.id, contract.id));
  await tx.insert(contractRenewals).values({
    entityId: contract.entityId,
    contractId: contract.id,
    previousEndsOn,
    newEndsOn,
    previousPriceCents: contract.priceCents,
    newPriceCents: priceCents,
    source,
    renewedById: actor.id,
  });
  await emitEvent(
    tx,
    "contract.renewed",
    {
      contractId: contract.id,
      customerId: contract.customerId,
      previousEndsOn,
      endsOn: newEndsOn,
      previousPriceCents: contract.priceCents,
      priceCents,
      source,
    },
    contract.entityId,
  );
  bucket?.renewed.push(contract.id);
  return readContract(tx, contract.id);
}

async function maintainOne(actor: Actor, contractId: string, today: string, now: Date, timeZone: string, bucket: Bucket) {
  await db.transaction(async (tx) => {
    let contract = await readContract(tx, contractId);
    if (contract.entityId !== actor.entityId) return;
    if (contract.status === "canceled" || contract.status === "ended") {
      await releaseFutureVisits(tx, contract.id, today, now, "cancel", null);
      return;
    }
    contract = await billDue(tx, contract, today, now, bucket);
    let guard = 0;
    while (contract.status === "active" && contract.autoRenew && contract.endsOn && contract.endsOn <= today && guard < 24) {
      contract = await renewRow(tx, actor, contract, "auto", today, contract.priceCents, contract.renewalTermMonths, bucket);
      guard += 1;
    }
    if (contract.status === "active" && contract.endsOn && contract.endsOn < today && !contract.autoRenew) {
      await tx.update(contracts).set({ status: "lapsed", lapsedAt: now, updatedAt: now }).where(eq(contracts.id, contract.id));
      await releaseFutureVisits(tx, contract.id, today, now, "lapse", contract.endsOn);
      await emitEvent(
        tx,
        "contract.lapsed",
        { contractId: contract.id, customerId: contract.customerId, endsOn: contract.endsOn },
        contract.entityId,
      );
      bucket.lapsed.push(contract.id);
      return;
    }
    if (contract.status === "active") {
      await remind(tx, contract, today, bucket);
      contract = await billDue(tx, contract, today, now, bucket);
      await syncSchedules(tx, contract, today, now, timeZone, bucket);
    }
  });
}

async function mirrorCharges(chargeIds: string[], injected?: StripeMirror) {
  if (!chargeIds.length) return;
  const key = stripeSecretKey();
  const client = injected ?? (key ? await liveStripe(key) : null);
  if (!client) return;
  for (const chargeId of chargeIds) {
    try {
      await mirrorOne(client, chargeId);
    } catch (err) {
      if (err instanceof AppError) throw err;
      const message = err instanceof Error ? err.message : "Stripe rejected the invoice.";
      await db.update(contractCharges).set({ stripeError: message.slice(0, 500) }).where(eq(contractCharges.id, chargeId));
    }
  }
}

async function liveStripe(key: string): Promise<StripeMirror> {
  const { default: Stripe } = await import("stripe");
  return new Stripe(key) as unknown as StripeMirror;
}

async function mirrorOne(client: StripeMirror, chargeId: string) {
  const [charge] = await db.select().from(contractCharges).where(eq(contractCharges.id, chargeId));
  if (!charge || charge.stripeInvoiceId || !charge.invoiceId) return;
  const [contract] = await db.select().from(contracts).where(eq(contracts.id, charge.contractId));
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, charge.invoiceId));
  const [customer] = contract ? await db.select().from(customers).where(eq(customers.id, contract.customerId)) : [];
  if (!contract || !invoice || !customer) return;
  let stripeCustomerId = contract.stripeCustomerId;
  if (!stripeCustomerId) {
    const created = await client.customers.create({
      name: customer.name,
      email: customer.email ?? undefined,
      metadata: { entityId: contract.entityId, customerId: customer.id },
    });
    stripeCustomerId = created.id;
    await db.update(contracts).set({ stripeCustomerId, updatedAt: new Date() }).where(eq(contracts.id, contract.id));
  }
  const description = `${contract.title || "Service contract"} (${charge.periodStart} to ${charge.periodEnd})`;
  const draft = await client.invoices.create({
    customer: stripeCustomerId,
    collection_method: "send_invoice",
    days_until_due: 15,
    auto_advance: false,
    pending_invoice_items_behavior: "exclude",
    metadata: {
      entityId: contract.entityId,
      contractId: contract.id,
      chargeId: charge.id,
      invoiceId: invoice.id,
      invoiceNumber: String(invoice.number),
    },
  });
  await client.invoiceItems.create({
    customer: stripeCustomerId,
    invoice: draft.id,
    amount: charge.amountCents,
    currency: "usd",
    description,
  });
  const finalized = await client.invoices.finalizeInvoice(draft.id);
  await db
    .update(contractCharges)
    .set({ stripeInvoiceId: finalized.id, stripeError: null })
    .where(eq(contractCharges.id, charge.id));
}

export async function maintainServiceContracts(actor: Actor, now = new Date(), options: MaintainOptions = {}) {
  assertOffice(actor);
  const settings = await getCompanySettings();
  const today = companyToday(settings.timeZone, now);
  const filters = [eq(contracts.entityId, actor.entityId)];
  if (options.onlyContractId) filters.push(eq(contracts.id, options.onlyContractId));
  const rows = await db
    .select({ id: contracts.id })
    .from(contracts)
    .where(and(...filters));
  const bucket: Bucket = { renewed: [], lapsed: [], reminded: [], invoiceIds: [], chargeIds: [], visitsCreated: 0 };
  try {
    for (const row of rows) {
      await maintainOne(actor, row.id, today, now, settings.timeZone, bucket);
    }
    const pending = await db
      .select({ id: contractCharges.id })
      .from(contractCharges)
      .where(
        and(
          eq(contractCharges.entityId, actor.entityId),
          isNull(contractCharges.stripeInvoiceId),
          options.onlyContractId ? eq(contractCharges.contractId, options.onlyContractId) : undefined,
        ),
      );
    const chargeIds = [...new Set([...bucket.chargeIds, ...pending.map((row) => row.id)])];
    await mirrorCharges(chargeIds, options.stripe);
  } finally {
    await safeDeliver();
  }
  return {
    data: {
      renewed: bucket.renewed,
      lapsed: bucket.lapsed,
      reminded: bucket.reminded,
      invoiceIds: bucket.invoiceIds,
      visitsCreated: bucket.visitsCreated,
    },
  };
}

export async function listContracts(actor: Actor) {
  assertOffice(actor);
  const rows = await db
    .select({
      id: contracts.id,
      customerId: contracts.customerId,
      customerName: customers.name,
      propertyId: contracts.propertyId,
      propertyLabel: properties.label,
      title: contracts.title,
      startsOn: contracts.startsOn,
      endsOn: contracts.endsOn,
      status: contracts.status,
      notes: contracts.notes,
      priceCents: contracts.priceCents,
      billingFrequency: contracts.billingFrequency,
      billingIntervalCount: contracts.billingIntervalCount,
      autoRenew: contracts.autoRenew,
      reminderDays: contracts.reminderDays,
      renewalTermMonths: contracts.renewalTermMonths,
      entityId: contracts.entityId,
    })
    .from(contracts)
    .innerJoin(customers, eq(customers.id, contracts.customerId))
    .innerJoin(properties, eq(properties.id, contracts.propertyId))
    .where(eq(contracts.entityId, actor.entityId))
    .orderBy(asc(contracts.endsOn), asc(contracts.startsOn));
  return { data: rows };
}

export async function getContract(actor: Actor, id: string) {
  const contract = await requireContract(actor, id);
  const [customer] = await db.select().from(customers).where(eq(customers.id, contract.customerId));
  const covered = await db
    .select({
      id: properties.id,
      label: properties.label,
      city: properties.city,
      line1: properties.line1,
    })
    .from(contractProperties)
    .innerJoin(properties, eq(properties.id, contractProperties.propertyId))
    .where(eq(contractProperties.contractId, id))
    .orderBy(asc(properties.label));
  const owned = await db
    .select({ id: properties.id, label: properties.label, city: properties.city })
    .from(properties)
    .where(eq(properties.customerId, contract.customerId))
    .orderBy(asc(properties.label));
  const equipment = await db.select().from(contractEquipment).where(eq(contractEquipment.contractId, id)).orderBy(asc(contractEquipment.name));
  const scheduleRows = await db.select().from(contractSchedules).where(eq(contractSchedules.contractId, id)).orderBy(asc(contractSchedules.createdAt));
  const schedules = [];
  for (const schedule of scheduleRows) {
    const [tech] = schedule.technicianId
      ? await db.select({ name: users.name }).from(users).where(eq(users.id, schedule.technicianId))
      : [undefined];
    const occurrences = await db
      .select({
        id: scheduleOccurrences.id,
        originalOn: scheduleOccurrences.originalOn,
        occursOn: scheduleOccurrences.occursOn,
        status: scheduleOccurrences.status,
        skipReason: scheduleOccurrences.skipReason,
        pinned: scheduleOccurrences.pinned,
        visitId: scheduleOccurrences.visitId,
        visitStatus: visits.status,
        technicianId: visits.technicianId,
        technicianName: users.name,
        scheduledStart: visits.scheduledStart,
      })
      .from(scheduleOccurrences)
      .leftJoin(visits, eq(visits.id, scheduleOccurrences.visitId))
      .leftJoin(users, eq(users.id, visits.technicianId))
      .where(eq(scheduleOccurrences.scheduleId, schedule.id))
      .orderBy(asc(scheduleOccurrences.occursOn));
    schedules.push({ ...schedule, technicianName: tech?.name ?? null, occurrences });
  }
  const charges = await db
    .select({
      id: contractCharges.id,
      periodStart: contractCharges.periodStart,
      periodEnd: contractCharges.periodEnd,
      amountCents: contractCharges.amountCents,
      invoiceId: contractCharges.invoiceId,
      invoiceNumber: invoices.number,
      invoiceStatus: invoices.status,
      stripeInvoiceId: contractCharges.stripeInvoiceId,
      stripeError: contractCharges.stripeError,
    })
    .from(contractCharges)
    .leftJoin(invoices, eq(invoices.id, contractCharges.invoiceId))
    .where(eq(contractCharges.contractId, id))
    .orderBy(asc(contractCharges.periodStart));
  const renewals = await db
    .select()
    .from(contractRenewals)
    .where(eq(contractRenewals.contractId, id))
    .orderBy(asc(contractRenewals.createdAt));
  return {
    data: {
      ...contract,
      customerName: customer?.name ?? null,
      coveredProperties: covered,
      customerProperties: owned,
      equipment,
      schedules,
      charges,
      renewals,
    },
  };
}

async function writeCoverage(tx: Tx, contractId: string, entityId: string, ids: string[]) {
  await tx.delete(contractProperties).where(eq(contractProperties.contractId, contractId));
  if (ids.length) {
    await tx.insert(contractProperties).values(ids.map((propertyId) => ({ contractId, propertyId, entityId })));
  }
}

async function writeEquipment(
  tx: Tx,
  contractId: string,
  entityId: string,
  items: z.infer<typeof equipmentSchema>[],
  allowed: Set<string>,
) {
  await tx.delete(contractEquipment).where(eq(contractEquipment.contractId, contractId));
  if (!items.length) return;
  for (const item of items) {
    if (item.propertyId && !allowed.has(item.propertyId)) {
      throw new AppError(400, "Equipment has to sit on a covered location.", "property_mismatch");
    }
  }
  await tx.insert(contractEquipment).values(
    items.map((item) => ({
      entityId,
      contractId,
      propertyId: item.propertyId ?? null,
      name: item.name,
      location: item.location ?? null,
      serial: item.serial ?? null,
      notes: item.notes ?? null,
    })),
  );
}

export async function createContract(actor: Actor, input: unknown, now = new Date()) {
  assertOffice(actor);
  const data = parse(
    z.object({
      customerId: z.string().uuid(),
      propertyId: z.string().uuid(),
      propertyIds: z.array(z.string().uuid()).max(30).optional(),
      title: z.string().trim().max(160).optional(),
      startsOn: daySchema,
      endsOn: daySchema.nullable().optional(),
      status: z.enum(["draft", "active", "ended", "lapsed", "canceled"]).optional(),
      priceCents: z.number().int().min(0).max(100_000_000).optional(),
      billingFrequency: frequencySchema.optional(),
      billingIntervalCount: z.number().int().min(1).max(36).optional(),
      scope: optionalText,
      notes: optionalText,
      autoRenew: z.boolean().optional(),
      renewalTermMonths: z.number().int().min(1).max(60).optional(),
      reminderDays: z.number().int().min(1).max(365).optional(),
      equipment: z.array(equipmentSchema).max(40).optional(),
      schedule: scheduleSchema.optional(),
    }),
    input,
  );
  assertTerm(data.startsOn, data.endsOn);
  const [customer] = await db.select().from(customers).where(eq(customers.id, data.customerId));
  if (!customer) throw notFound("Customer not found.");
  assertActiveBook(actor, customer.entityId);
  const ids = coveredIds(data.propertyId, data.propertyIds);
  await assertCovered(customer.id, actor.entityId, ids);
  if (data.schedule) await assertTech(data.schedule.technicianId ?? null);
  const status = data.status ?? "draft";
  const id = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(contracts)
      .values({
        entityId: actor.entityId,
        customerId: customer.id,
        propertyId: data.propertyId,
        title: data.title ?? "",
        startsOn: data.startsOn,
        endsOn: data.endsOn ?? null,
        status,
        priceCents: data.priceCents ?? 0,
        billingFrequency: data.billingFrequency ?? "annual",
        billingIntervalCount: data.billingIntervalCount ?? 1,
        scope: data.scope ?? null,
        notes: data.notes ?? null,
        autoRenew: data.autoRenew ?? false,
        renewalTermMonths: data.renewalTermMonths ?? 12,
        reminderDays: data.reminderDays ?? 30,
        nextBillOn: status === "active" ? data.startsOn : null,
      })
      .returning();
    await writeCoverage(tx, row.id, actor.entityId, ids);
    if (data.equipment) await writeEquipment(tx, row.id, actor.entityId, data.equipment, new Set(ids));
    if (data.schedule) {
      await tx.insert(contractSchedules).values({
        entityId: actor.entityId,
        contractId: row.id,
        ...scheduleValues(data.schedule),
      });
    }
    return row.id;
  });
  if (status === "active") await maintainServiceContracts(actor, now, { onlyContractId: id });
  return getContract(actor, id);
}

export async function updateContract(actor: Actor, id: string, input: unknown, now = new Date()) {
  assertOffice(actor);
  const existing = await requireContract(actor, id);
  const data = parse(
    z.object({
      propertyId: z.string().uuid().optional(),
      propertyIds: z.array(z.string().uuid()).max(30).optional(),
      title: z.string().trim().max(160).optional(),
      startsOn: daySchema.optional(),
      endsOn: daySchema.nullable().optional(),
      status: z.enum(["draft", "active", "ended"]).optional(),
      priceCents: z.number().int().min(0).max(100_000_000).optional(),
      billingFrequency: frequencySchema.optional(),
      billingIntervalCount: z.number().int().min(1).max(36).optional(),
      scope: optionalText,
      notes: optionalText,
      autoRenew: z.boolean().optional(),
      renewalTermMonths: z.number().int().min(1).max(60).optional(),
      reminderDays: z.number().int().min(1).max(365).optional(),
      equipment: z.array(equipmentSchema).max(40).optional(),
    }),
    input,
  );
  const startsOn = data.startsOn ?? existing.startsOn;
  const endsOn = data.endsOn === undefined ? existing.endsOn : data.endsOn;
  assertTerm(startsOn, endsOn);
  const propertyId = data.propertyId ?? existing.propertyId;
  const ids = data.propertyIds ? coveredIds(propertyId, data.propertyIds) : null;
  if (ids) await assertCovered(existing.customerId, actor.entityId, ids);
  else if (data.propertyId) await assertCovered(existing.customerId, actor.entityId, [propertyId]);
  const nextStatus = data.status ?? existing.status;
  await db.transaction(async (tx) => {
    const [charges] = await tx.select({ id: contractCharges.id }).from(contractCharges).where(eq(contractCharges.contractId, id)).limit(1);
    let nextBillOn = existing.nextBillOn;
    if (!charges && data.startsOn && nextStatus === "active") nextBillOn = startsOn;
    if (existing.status !== "active" && nextStatus === "active" && !nextBillOn) nextBillOn = startsOn;
    await tx
      .update(contracts)
      .set({
        propertyId,
        title: data.title ?? existing.title,
        startsOn,
        endsOn,
        status: nextStatus,
        priceCents: data.priceCents ?? existing.priceCents,
        billingFrequency: data.billingFrequency ?? existing.billingFrequency,
        billingIntervalCount: data.billingIntervalCount ?? existing.billingIntervalCount,
        scope: data.scope === undefined ? existing.scope : data.scope,
        notes: data.notes === undefined ? existing.notes : data.notes,
        autoRenew: data.autoRenew ?? existing.autoRenew,
        renewalTermMonths: data.renewalTermMonths ?? existing.renewalTermMonths,
        reminderDays: data.reminderDays ?? existing.reminderDays,
        nextBillOn,
        updatedAt: new Date(),
      })
      .where(eq(contracts.id, id));
    if (ids) await writeCoverage(tx, id, actor.entityId, ids);
    else if (data.propertyId) {
      await tx.insert(contractProperties).values({ contractId: id, propertyId, entityId: actor.entityId }).onConflictDoNothing();
    }
    if (data.equipment) {
      const allowed = new Set(ids ?? (await tx.select().from(contractProperties).where(eq(contractProperties.contractId, id))).map((row) => row.propertyId));
      await writeEquipment(tx, id, actor.entityId, data.equipment, allowed);
    }
  });
  if (nextStatus === "canceled") return cancelContract(actor, id, now);
  await maintainServiceContracts(actor, now, { onlyContractId: id });
  return getContract(actor, id);
}

export async function cancelContract(actor: Actor, id: string, now = new Date()) {
  assertOffice(actor);
  const existing = await requireContract(actor, id);
  if (existing.status === "canceled") return getContract(actor, id);
  const settings = await getCompanySettings();
  const today = companyToday(settings.timeZone, now);
  await db.transaction(async (tx) => {
    await tx.update(contracts).set({ status: "canceled", canceledAt: now, updatedAt: now }).where(eq(contracts.id, id));
    await releaseFutureVisits(tx, id, today, now, "cancel", null);
    await emitEvent(tx, "contract.canceled", { contractId: id, customerId: existing.customerId }, existing.entityId);
  });
  await safeDeliver();
  return getContract(actor, id);
}

export async function renewContract(actor: Actor, id: string, input: unknown, now = new Date()) {
  assertOffice(actor);
  const existing = await requireContract(actor, id);
  if (existing.status !== "active" && existing.status !== "lapsed") {
    throw new AppError(409, "Renew an active or lapsed contract.", "invalid_state");
  }
  const data = parse(
    z.object({
      priceCents: z.number().int().min(0).max(100_000_000).optional(),
      termMonths: z.number().int().min(1).max(60).optional(),
    }),
    input,
  );
  const settings = await getCompanySettings();
  const today = companyToday(settings.timeZone, now);
  await db.transaction(async (tx) => {
    const current = await readContract(tx, id);
    await renewRow(
      tx,
      actor,
      current,
      "manual",
      today,
      data.priceCents ?? current.priceCents,
      data.termMonths ?? current.renewalTermMonths,
    );
  });
  await maintainServiceContracts(actor, now, { onlyContractId: id });
  return getContract(actor, id);
}

export async function listUpcomingRenewals(actor: Actor, withinDays = 60, now = new Date()) {
  assertOffice(actor);
  const window = Number.isFinite(withinDays) ? Math.min(365, Math.max(1, Math.trunc(withinDays))) : 60;
  const settings = await getCompanySettings();
  const today = companyToday(settings.timeZone, now);
  const horizon = shiftDay(today, window);
  const rows = await db
    .select({
      id: contracts.id,
      title: contracts.title,
      customerId: contracts.customerId,
      customerName: customers.name,
      endsOn: contracts.endsOn,
      priceCents: contracts.priceCents,
      autoRenew: contracts.autoRenew,
      reminderDays: contracts.reminderDays,
      status: contracts.status,
      billingFrequency: contracts.billingFrequency,
    })
    .from(contracts)
    .innerJoin(customers, eq(customers.id, contracts.customerId))
    .where(and(eq(contracts.entityId, actor.entityId), eq(contracts.status, "active")));
  const data = rows
    .filter((row) => {
      if (!row.endsOn || row.endsOn < today) return false;
      const personal = shiftDay(today, row.reminderDays);
      return row.endsOn <= horizon || row.endsOn <= personal;
    })
    .map((row) => ({
      id: row.id,
      title: row.title,
      customerId: row.customerId,
      customerName: row.customerName,
      endsOn: row.endsOn as string,
      priceCents: row.priceCents,
      autoRenew: row.autoRenew,
      reminderDays: row.reminderDays,
      status: row.status,
      billingFrequency: row.billingFrequency,
      daysLeft: daysBetween(today, row.endsOn as string),
    }))
    .sort((left, right) => left.endsOn.localeCompare(right.endsOn) || left.customerName.localeCompare(right.customerName));
  return { data };
}

export async function createContractSchedule(actor: Actor, contractId: string, input: unknown, now = new Date()) {
  assertOffice(actor);
  const contract = await requireContract(actor, contractId);
  const data = parse(scheduleSchema, input);
  await assertTech(data.technicianId ?? null);
  await db.insert(contractSchedules).values({
    entityId: contract.entityId,
    contractId: contract.id,
    ...scheduleValues(data),
  });
  if (contract.status === "active") await maintainServiceContracts(actor, now, { onlyContractId: contract.id });
  return getContract(actor, contract.id);
}

export async function updateContractSchedule(actor: Actor, contractId: string, scheduleId: string, input: unknown, now = new Date()) {
  assertOffice(actor);
  const contract = await requireContract(actor, contractId);
  const [schedule] = await db.select().from(contractSchedules).where(eq(contractSchedules.id, scheduleId));
  if (!schedule || schedule.contractId !== contract.id || schedule.entityId !== actor.entityId) throw notFound("Schedule not found.");
  const data = parse(scheduleSchema.partial(), input);
  if (data.technicianId) await assertTech(data.technicianId);
  const next = scheduleValues({
    frequency: data.frequency ?? schedule.frequency,
    intervalCount: data.intervalCount ?? schedule.intervalCount,
    intervalUnit: data.intervalUnit ?? schedule.intervalUnit,
    anchorOn: data.anchorOn ?? schedule.anchorOn,
    localStart: data.localStart ?? schedule.localStart,
    durationMinutes: data.durationMinutes ?? schedule.durationMinutes,
    technicianId: data.technicianId === undefined ? schedule.technicianId : data.technicianId,
    horizonDays: data.horizonDays ?? schedule.horizonDays,
    title: data.title ?? schedule.title,
    instructions: data.instructions === undefined ? schedule.instructions : data.instructions,
    active: data.active ?? schedule.active,
  });
  await db.update(contractSchedules).set({ ...next, updatedAt: new Date() }).where(eq(contractSchedules.id, schedule.id));
  if (contract.status === "active") await maintainServiceContracts(actor, now, { onlyContractId: contract.id });
  return getContract(actor, contract.id);
}

export async function skipContractOccurrence(actor: Actor, contractId: string, occurrenceId: string, input: unknown, now = new Date()) {
  assertOffice(actor);
  const contract = await requireContract(actor, contractId);
  const data = parse(z.object({ reason: z.string().trim().max(200).optional() }), input ?? {});
  await db.transaction(async (tx) => {
    const [occurrence] = await tx.select().from(scheduleOccurrences).where(eq(scheduleOccurrences.id, occurrenceId));
    if (!occurrence || occurrence.entityId !== contract.entityId) throw notFound("Visit not found.");
    const [schedule] = await tx.select().from(contractSchedules).where(eq(contractSchedules.id, occurrence.scheduleId));
    if (!schedule || schedule.contractId !== contract.id) throw notFound("Visit not found.");
    if (occurrence.status === "skipped") return;
    if (occurrence.visitId) {
      const [visit] = await tx.select().from(visits).where(eq(visits.id, occurrence.visitId));
      if (visit && (visit.status === "completed" || visit.status === "en_route" || visit.status === "on_site")) {
        throw new AppError(409, "This visit has already started.", "invalid_state");
      }
      if (visit && visit.status === "scheduled") {
        await tx.update(visits).set({ status: "canceled", updatedAt: now }).where(eq(visits.id, visit.id));
        await recomputeJob(tx, visit.jobId);
      }
    }
    await tx
      .update(scheduleOccurrences)
      .set({ status: "skipped", pinned: true, skipReason: data.reason || "Skipped by the office." })
      .where(eq(scheduleOccurrences.id, occurrence.id));
  });
  return getContract(actor, contract.id);
}

export async function addContractEquipment(actor: Actor, contractId: string, input: unknown) {
  assertOffice(actor);
  const contract = await requireContract(actor, contractId);
  const data = parse(equipmentSchema, input);
  const covered = await db.select().from(contractProperties).where(eq(contractProperties.contractId, contract.id));
  const allowed = new Set(covered.map((row) => row.propertyId));
  if (data.propertyId && !allowed.has(data.propertyId)) {
    throw new AppError(400, "Equipment has to sit on a covered location.", "property_mismatch");
  }
  await db.insert(contractEquipment).values({
    entityId: contract.entityId,
    contractId: contract.id,
    propertyId: data.propertyId ?? null,
    name: data.name,
    location: data.location ?? null,
    serial: data.serial ?? null,
    notes: data.notes ?? null,
  });
  return getContract(actor, contract.id);
}

export async function removeContractEquipment(actor: Actor, contractId: string, equipmentId: string) {
  assertOffice(actor);
  const contract = await requireContract(actor, contractId);
  const [row] = await db.select().from(contractEquipment).where(eq(contractEquipment.id, equipmentId));
  if (!row || row.contractId !== contract.id || row.entityId !== contract.entityId) throw notFound("Equipment not found.");
  await db.delete(contractEquipment).where(eq(contractEquipment.id, row.id));
  return getContract(actor, contract.id);
}
