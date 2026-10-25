import {
  brands,
  customers,
  db,
  entities,
  entityMemberships,
  jobs,
  properties,
  receptionistConversations,
  receptionistMessages,
  receptionistSandboxMessages,
  receptionistSettings,
  requests,
  users,
  visits,
  type ReceptionistSlot,
} from "@adel/db";
import { companyToday, shiftDay, zonedDateTime } from "@adel/db/zoned";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { nextNumber, type Tx } from "./db";
import { AppError, notFound } from "./errors";
import { parse } from "./parse";
import { assertOffice, type Actor } from "./permissions";
import { assertActiveBook } from "./scope";
import { getCompanySettings } from "./settings";
import { emitEvent, safeDeliver } from "./webhooks";
import {
  isElectricalEmergency,
  messagingProvider,
  safetyScript,
  translationProvider,
  type OutboundMessage,
  type ReceptionistLanguage,
} from "./receptionist-providers";

const SLOT_MINUTES = 120;
const LOOKAHEAD_DAYS = 14;
const MAX_SLOTS = 3;
const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

type Language = ReceptionistLanguage;
type Step = "name" | "phone" | "address" | "problem" | "slots" | "closed";

function pair(language: Language, en: string, es: string) {
  return language === "es" ? { body: es, bodyEn: en } : { body: en, bodyEn: en };
}

export function defaultGreeting(entityName: string) {
  return {
    en: `Thanks for contacting ${entityName}. I can take your name, a phone number, the service address, and what's going on. If there's an open time, I can hold a tentative visit.`,
    es: `Gracias por comunicarse con ${entityName}. Puedo anotar su nombre, un teléfono, la dirección del servicio y qué está pasando. Si hay un horario libre, puedo apartar una visita tentativa.`,
  };
}

function phoneKey(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

function norm(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function weekdayOf(day: string, timeZone: string) {
  const date = zonedDateTime(day, "12:00", timeZone);
  const name = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(date);
  return WEEKDAY[name] ?? 0;
}

function formatSlot(start: Date, end: Date, timeZone: string, locale: "en-US" | "es-US") {
  const day = new Intl.DateTimeFormat(locale, { timeZone, weekday: "short", month: "short", day: "numeric" }).format(start);
  const startTime = new Intl.DateTimeFormat(locale, { timeZone, hour: "numeric", minute: "2-digit" }).format(start);
  const endTime = new Intl.DateTimeFormat(locale, { timeZone, hour: "numeric", minute: "2-digit" }).format(end);
  return `${day}, ${startTime}–${endTime}`;
}

function clockOk(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return false;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

function chosenIndex(text: string) {
  const trimmed = text.trim().toLowerCase();
  const number = /^(\d+)\b/.exec(trimmed);
  if (number) return Number(number[1]);
  if (/^(the )?first$|^el primero$|^la primera$|^primero$/.test(trimmed)) return 1;
  if (/second|segundo/.test(trimmed)) return 2;
  if (/third|tercero/.test(trimmed)) return 3;
  return null;
}

async function ensureReceptionistSettings(entityId: string, tx: Tx | typeof db = db) {
  const [existing] = await tx.select().from(receptionistSettings).where(eq(receptionistSettings.entityId, entityId));
  if (existing) return existing;
  const [entity] = await tx.select().from(entities).where(eq(entities.id, entityId));
  if (!entity) throw notFound("Company not found.");
  const greeting = defaultGreeting(entity.name);
  const [tech] = await tx
    .select({ id: users.id })
    .from(entityMemberships)
    .innerJoin(users, eq(users.id, entityMemberships.userId))
    .where(and(eq(entityMemberships.entityId, entityId), eq(entityMemberships.role, "tech"), eq(users.active, true)))
    .orderBy(asc(users.name))
    .limit(1);
  const [created] = await tx
    .insert(receptionistSettings)
    .values({
      entityId,
      enabled: true,
      greetingEn: greeting.en,
      greetingEs: greeting.es,
      hoursStart: "08:00",
      hoursEnd: "17:00",
      hoursDays: [1, 2, 3, 4, 5],
      onCallUserId: tech?.id ?? null,
    })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [again] = await tx.select().from(receptionistSettings).where(eq(receptionistSettings.entityId, entityId));
  if (!again) throw new AppError(500, "Receptionist settings are missing.", "settings_missing");
  return again;
}

type Busy = { start: Date; end: Date };

async function busyWindows(tx: Tx, entityId: string): Promise<Busy[]> {
  const rows = await tx
    .select({ start: visits.scheduledStart, end: visits.scheduledEnd })
    .from(visits)
    .where(and(eq(visits.entityId, entityId), ne(visits.status, "canceled")));
  return rows;
}

function overlaps(windows: Busy[], start: Date, end: Date) {
  return windows.some((window) => window.start < end && window.end > start);
}

export async function listOpenSlots(entityId: string, now = new Date()): Promise<ReceptionistSlot[]> {
  return db.transaction(async (tx) => openSlots(tx, entityId, now));
}

async function openSlots(tx: Tx, entityId: string, now: Date): Promise<ReceptionistSlot[]> {
  const company = await getCompanySettings();
  const settings = await ensureReceptionistSettings(entityId, tx);
  const timeZone = company.timeZone;
  const today = companyToday(timeZone, now);
  const windows = await busyWindows(tx, entityId);
  const hoursDays = settings.hoursDays.map(Number);
  const slots: ReceptionistSlot[] = [];
  for (let offset = 0; offset < LOOKAHEAD_DAYS && slots.length < MAX_SLOTS; offset += 1) {
    const day = shiftDay(today, offset);
    if (!hoursDays.includes(weekdayOf(day, timeZone))) continue;
    let cursor = zonedDateTime(day, settings.hoursStart, timeZone);
    const dayEnd = zonedDateTime(day, settings.hoursEnd, timeZone);
    while (slots.length < MAX_SLOTS) {
      const slotEnd = new Date(cursor.getTime() + SLOT_MINUTES * 60 * 1000);
      if (slotEnd > dayEnd) break;
      if (cursor.getTime() > now.getTime() + 30 * 60 * 1000 && !overlaps(windows, cursor, slotEnd)) {
        slots.push({
          index: slots.length + 1,
          start: cursor.toISOString(),
          end: slotEnd.toISOString(),
          label: formatSlot(cursor, slotEnd, timeZone, "en-US"),
          labelEs: formatSlot(cursor, slotEnd, timeZone, "es-US"),
        });
      }
      cursor = slotEnd;
    }
  }
  return slots;
}

function slotList(language: Language, slots: ReceptionistSlot[]) {
  const lines = slots.map((slot) => `${slot.index}. ${language === "es" ? slot.labelEs : slot.label}`).join("\n");
  return pair(
    language,
    `I can hold one of these tentative visits:\n${slots.map((slot) => `${slot.index}. ${slot.label}`).join("\n")}\nReply with the number.`,
    `Puedo apartar una de estas visitas tentativas:\n${lines}\nResponda con el número.`,
  );
}

function parseAddress(raw: string) {
  const zip = raw.match(/\b(\d{5})(?:-\d{4})?\b/)?.[1] ?? "00000";
  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const line1 = (parts[0] ?? raw).slice(0, 200);
  let city = "Naples";
  if (parts[1]) {
    const cleaned = parts[1].replace(/\b[A-Z]{2}\b/i, "").replace(/\d{5}(?:-\d{4})?/, "").trim();
    if (cleaned) city = cleaned.slice(0, 80);
  }
  const state = raw.match(/\b(FL|GA|AL|SC|NC|NY|TX|CA)\b/i)?.[1]?.toUpperCase() ?? "FL";
  return { line1, city, state, postalCode: zip };
}

async function matchOrCreateCustomer(
  tx: Tx,
  entityId: string,
  brandId: string,
  name: string,
  phone: string,
  address: string,
) {
  const people = await tx.select().from(customers).where(eq(customers.entityId, entityId));
  const key = phoneKey(phone);
  const byPhone = key.length >= 10 ? people.filter((person) => phoneKey(person.phone ?? "") === key) : [];
  let customer = byPhone[0] ?? null;
  if (!customer) {
    const byName = people.filter((person) => person.name.trim().toLowerCase() === name.trim().toLowerCase());
    const unique = byName.length === 1 ? byName[0] : null;
    if (unique && (!unique.phone || phoneKey(unique.phone) === key)) customer = unique;
  }
  if (customer && customer.entityId !== entityId) {
    throw new AppError(500, "Customer match crossed companies.", "entity_mismatch");
  }
  if (!customer) {
    const [created] = await tx
      .insert(customers)
      .values({
        entityId,
        brandId,
        name: name.trim(),
        phone: phone.trim(),
        notes: "Added by the receptionist.",
      })
      .returning();
    customer = created;
  }
  const places = await tx
    .select()
    .from(properties)
    .where(and(eq(properties.customerId, customer.id), eq(properties.entityId, entityId)));
  const hay = norm(address);
  const property =
    places.find((place) => {
      const line = norm(place.line1);
      return line.length >= 6 && hay.includes(line);
    }) ?? null;
  if (property) return { customer, property };
  const parsed = parseAddress(address);
  const [createdProperty] = await tx
    .insert(properties)
    .values({
      entityId,
      customerId: customer.id,
      label: "Service address",
      line1: parsed.line1,
      city: parsed.city,
      state: parsed.state,
      postalCode: parsed.postalCode,
    })
    .returning();
  return { customer, property: createdProperty };
}

async function createIntake(
  tx: Tx,
  conversation: typeof receptionistConversations.$inferSelect,
  entityName: string,
) {
  if (conversation.requestId && conversation.customerId && conversation.propertyId) {
    return {
      customerId: conversation.customerId,
      propertyId: conversation.propertyId,
      requestId: conversation.requestId,
    };
  }
  const name = conversation.callerName?.trim();
  const phone = conversation.callerPhone?.trim();
  const address = conversation.serviceAddress?.trim();
  const problem = conversation.problem?.trim();
  if (!name || !phone || !address || !problem) return null;
  const [brand] = await tx.select().from(brands).where(eq(brands.entityId, conversation.entityId)).orderBy(asc(brands.name)).limit(1);
  if (!brand) throw new AppError(500, "That company has no brand.", "settings_missing");
  const { customer, property } = await matchOrCreateCustomer(tx, conversation.entityId, brand.id, name, phone, address);
  const title = problem.slice(0, 160);
  const [request] = await tx
    .insert(requests)
    .values({
      entityId: conversation.entityId,
      customerId: customer.id,
      propertyId: property.id,
      brandId: brand.id,
      title,
      description: `${problem}\n\nLogged by the ${entityName} receptionist (${conversation.channel}, ${conversation.language}).`,
      source: conversation.channel === "web" ? "web" : "phone",
      status: "new",
    })
    .returning();
  await emitEvent(
    tx,
    "request.created",
    {
      requestId: request.id,
      customerId: request.customerId,
      propertyId: request.propertyId,
      brandId: request.brandId,
      title: request.title,
      status: request.status,
      conversationId: conversation.id,
      source: "receptionist",
    },
    conversation.entityId,
  );
  return { customerId: customer.id, propertyId: property.id, requestId: request.id };
}

async function say(tx: Tx, conversationId: string, spoken: { body: string; bodyEn: string }) {
  await tx.insert(receptionistMessages).values({
    conversationId,
    role: "receptionist",
    body: spoken.body,
    bodyEn: spoken.bodyEn,
  });
}

async function onCallPerson(tx: Tx, entityId: string, userId: string | null) {
  if (!userId) return null;
  const [row] = await tx
    .select({ id: users.id, name: users.name, phone: users.phone })
    .from(entityMemberships)
    .innerJoin(users, eq(users.id, entityMemberships.userId))
    .where(and(eq(entityMemberships.entityId, entityId), eq(entityMemberships.userId, userId), eq(users.active, true)));
  return row ?? null;
}

async function recordOutbound(tx: Tx, message: OutboundMessage) {
  const provider = messagingProvider(message.channel);
  await provider.deliver(message, tx);
}

function publicConversation(row: typeof receptionistConversations.$inferSelect, entityName: string) {
  return {
    id: row.id,
    entityId: row.entityId,
    entityName,
    channel: row.channel,
    language: row.language,
    step: row.step,
    outcome: row.outcome,
    callerName: row.callerName,
    callerPhone: row.callerPhone,
    serviceAddress: row.serviceAddress,
    problem: row.problem,
    customerId: row.customerId,
    propertyId: row.propertyId,
    requestId: row.requestId,
    jobId: row.jobId,
    visitId: row.visitId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function loadPublic(id: string) {
  const [row] = await db
    .select({ conversation: receptionistConversations, entityName: entities.name })
    .from(receptionistConversations)
    .innerJoin(entities, eq(entities.id, receptionistConversations.entityId))
    .where(eq(receptionistConversations.id, id));
  if (!row) throw notFound("Conversation not found.");
  const messages = await db
    .select({
      id: receptionistMessages.id,
      role: receptionistMessages.role,
      body: receptionistMessages.body,
      bodyEn: receptionistMessages.bodyEn,
      createdAt: receptionistMessages.createdAt,
    })
    .from(receptionistMessages)
    .where(eq(receptionistMessages.conversationId, id))
    .orderBy(asc(receptionistMessages.createdAt));
  return {
    data: {
      conversation: publicConversation(row.conversation, row.entityName),
      messages,
      slots: row.conversation.step === "slots" ? row.conversation.offeredSlots : [],
    },
  };
}

export async function startReceptionistConversation(input: unknown) {
  const data = parse(
    z.object({
      entitySlug: z.string().trim().min(1).max(80),
      channel: z.enum(["phone", "web"]),
      language: z.enum(["en", "es"]),
    }),
    input,
  );
  const id = await db.transaction(async (tx) => {
    const [entity] = await tx.select().from(entities).where(eq(entities.slug, data.entitySlug.toLowerCase()));
    if (!entity) throw notFound("Company not found.");
    const settings = await ensureReceptionistSettings(entity.id, tx);
    const language = data.language;
    const enabled = settings.enabled;
    const [conversation] = await tx
      .insert(receptionistConversations)
      .values({
        entityId: entity.id,
        channel: data.channel,
        language,
        step: enabled ? "name" : "closed",
        outcome: enabled ? "collecting" : "off",
        offeredSlots: [],
      })
      .returning();
    const greeting = enabled
      ? pair(
          language,
          `${settings.greetingEn}\n\nWhat's your name?`,
          `${settings.greetingEs}\n\n¿Cómo se llama?`,
        )
      : pair(
          language,
          `${entity.name} is not taking receptionist messages right now. Please call the office during business hours.`,
          `${entity.name} no está tomando mensajes de la recepcionista en este momento. Llame a la oficina en el horario de atención.`,
        );
    await say(tx, conversation.id, greeting);
    return conversation.id;
  });
  return loadPublic(id);
}

async function bookSlot(
  tx: Tx,
  conversation: typeof receptionistConversations.$inferSelect,
  entityName: string,
  slot: ReceptionistSlot,
) {
  const intake = await createIntake(tx, conversation, entityName);
  if (!intake) throw new AppError(409, "Name, phone, address, and the problem are required before booking.", "invalid_state");
  const windows = await busyWindows(tx, conversation.entityId);
  const start = new Date(slot.start);
  const end = new Date(slot.end);
  if (overlaps(windows, start, end)) return { taken: true as const, intake };
  const [brand] = await tx.select().from(brands).where(eq(brands.entityId, conversation.entityId)).orderBy(asc(brands.name)).limit(1);
  if (!brand) throw new AppError(500, "That company has no brand.", "settings_missing");
  const number = await nextNumber(tx, conversation.entityId, "job");
  const title = (conversation.problem ?? "Receptionist visit").slice(0, 160);
  const [job] = await tx
    .insert(jobs)
    .values({
      entityId: conversation.entityId,
      number,
      customerId: intake.customerId,
      propertyId: intake.propertyId,
      brandId: brand.id,
      title,
      instructions: "Tentative visit from the receptionist. Confirm with the customer before treating this as final.",
      status: "scheduled",
    })
    .returning();
  const [visit] = await tx
    .insert(visits)
    .values({
      entityId: conversation.entityId,
      jobId: job.id,
      technicianId: null,
      scheduledStart: start,
      scheduledEnd: end,
      status: "scheduled",
    })
    .returning();
  await emitEvent(
    tx,
    "job.scheduled",
    { jobId: job.id, number: job.number, visitId: visit.id, requestId: intake.requestId, conversationId: conversation.id },
    conversation.entityId,
  );
  await emitEvent(
    tx,
    "visit.booked",
    {
      visitId: visit.id,
      jobId: job.id,
      requestId: intake.requestId,
      conversationId: conversation.id,
      scheduledStart: slot.start,
      scheduledEnd: slot.end,
    },
    conversation.entityId,
  );
  const when = conversation.language === "es" ? slot.labelEs : slot.label;
  const confirmation = pair(
    conversation.language as Language,
    `${entityName} held a tentative visit for ${conversation.callerName} at ${conversation.serviceAddress} on ${slot.label}. The office will confirm. This is not final until they do.`,
    `${entityName} apartó una visita tentativa para ${conversation.callerName} en ${conversation.serviceAddress} el ${when}. La oficina confirmará. Todavía no es una cita final.`,
  );
  await say(tx, conversation.id, confirmation);
  const outbound: OutboundMessage = {
    entityId: conversation.entityId,
    conversationId: conversation.id,
    channel: conversation.channel === "phone" ? "sms" : "chat",
    kind: conversation.channel === "phone" ? "booking_confirmation" : "chat_confirmation",
    toPhone: conversation.channel === "phone" ? conversation.callerPhone : null,
    body: confirmation.body,
    bodyEn: confirmation.bodyEn,
  };
  await recordOutbound(tx, outbound);
  await tx
    .update(receptionistConversations)
    .set({
      customerId: intake.customerId,
      propertyId: intake.propertyId,
      requestId: intake.requestId,
      jobId: job.id,
      visitId: visit.id,
      step: "closed",
      outcome: "booked",
      offeredSlots: [],
      updatedAt: new Date(),
    })
    .where(eq(receptionistConversations.id, conversation.id));
  return { taken: false as const, intake };
}

async function escalate(
  tx: Tx,
  conversation: typeof receptionistConversations.$inferSelect,
  entityName: string,
  settings: typeof receptionistSettings.$inferSelect,
) {
  const intake = await createIntake(tx, { ...conversation }, entityName);
  const person = await onCallPerson(tx, conversation.entityId, settings.onCallUserId);
  const script = safetyScript(conversation.language as Language, entityName);
  await say(tx, conversation.id, script);
  const who = conversation.callerName ?? "A caller";
  const phone = conversation.callerPhone ?? "no phone yet";
  const where = conversation.serviceAddress ?? "no address yet";
  const problem = conversation.problem ?? "No details yet.";
  const sms = pair(
    "en",
    `${entityName} safety escalation. ${who} (${phone}) at ${where}. They said: ${problem}. Sandbox text only. No live SMS was sent.`,
    `${entityName} safety escalation. ${who} (${phone}) at ${where}. They said: ${problem}. Sandbox text only. No live SMS was sent.`,
  );
  const voice = pair(
    "en",
    `Sandbox call to ${person?.name ?? "the on-call technician"} at ${person?.phone ?? "no phone on file"}. ${entityName} safety escalation from ${who}. ${problem}. No live call was placed.`,
    `Sandbox call to ${person?.name ?? "the on-call technician"} at ${person?.phone ?? "no phone on file"}. ${entityName} safety escalation from ${who}. ${problem}. No live call was placed.`,
  );
  await recordOutbound(tx, {
    entityId: conversation.entityId,
    conversationId: conversation.id,
    channel: "sms",
    kind: "safety_sms",
    toPhone: person?.phone ?? null,
    body: sms.body,
    bodyEn: sms.bodyEn,
  });
  await recordOutbound(tx, {
    entityId: conversation.entityId,
    conversationId: conversation.id,
    channel: "voice",
    kind: "safety_call",
    toPhone: person?.phone ?? null,
    body: voice.body,
    bodyEn: voice.bodyEn,
  });
  await emitEvent(
    tx,
    "safety.escalated",
    {
      conversationId: conversation.id,
      requestId: intake?.requestId ?? null,
      onCallUserId: person?.id ?? null,
      callerPhone: conversation.callerPhone,
      problem,
    },
    conversation.entityId,
  );
  await tx
    .update(receptionistConversations)
    .set({
      callerName: conversation.callerName,
      callerPhone: conversation.callerPhone,
      serviceAddress: conversation.serviceAddress,
      problem: conversation.problem,
      customerId: intake?.customerId ?? conversation.customerId,
      propertyId: intake?.propertyId ?? conversation.propertyId,
      requestId: intake?.requestId ?? conversation.requestId,
      step: "closed",
      outcome: "escalated",
      offeredSlots: [],
      updatedAt: new Date(),
    })
    .where(eq(receptionistConversations.id, conversation.id));
}

function callerEnglish(language: Language, text: string) {
  return translationProvider().toEnglish(text, language);
}

export async function postReceptionistMessage(conversationId: string, input: unknown) {
  const data = parse(z.object({ text: z.string().trim().min(1).max(2000) }), input);
  await db.transaction(async (tx) => {
    const [found] = await tx
      .select({ conversation: receptionistConversations, entityName: entities.name })
      .from(receptionistConversations)
      .innerJoin(entities, eq(entities.id, receptionistConversations.entityId))
      .where(eq(receptionistConversations.id, conversationId));
    if (!found) throw notFound("Conversation not found.");
    let conversation = found.conversation;
    const entityName = found.entityName;
    const language = conversation.language as Language;
    const settings = await ensureReceptionistSettings(conversation.entityId, tx);
    await tx.insert(receptionistMessages).values({
      conversationId: conversation.id,
      role: "caller",
      body: data.text,
      bodyEn: callerEnglish(language, data.text),
    });

    if (!settings.enabled && conversation.outcome === "collecting") {
      await say(
        tx,
        conversation.id,
        pair(
          language,
          `${entityName} is not taking receptionist messages right now. Please call the office during business hours.`,
          `${entityName} no está tomando mensajes de la recepcionista en este momento. Llame a la oficina en el horario de atención.`,
        ),
      );
      await tx
        .update(receptionistConversations)
        .set({ step: "closed", outcome: "off", updatedAt: new Date() })
        .where(eq(receptionistConversations.id, conversation.id));
      return;
    }

    if (conversation.outcome === "booked" || conversation.outcome === "escalated" || conversation.outcome === "off") {
      await say(
        tx,
        conversation.id,
        pair(language, "The office already has this conversation.", "La oficina ya tiene esta conversación."),
      );
      return;
    }

    const emergency = isElectricalEmergency(data.text);
    const step = conversation.step as Step;
    if (step === "name" && !emergency) {
      if (!/[a-zA-ZáéíóúñÁÉÍÓÚÑ]/.test(data.text) || data.text.trim().length < 2) {
        await say(tx, conversation.id, pair(language, "I need your name to log this.", "Necesito su nombre para anotarlo."));
        return;
      }
      await tx
        .update(receptionistConversations)
        .set({ callerName: data.text.trim(), step: "phone", updatedAt: new Date() })
        .where(eq(receptionistConversations.id, conversation.id));
      await say(tx, conversation.id, pair(language, "What's the best phone number to reach you?", "¿Cuál es el mejor número para llamarle?"));
      return;
    }
    if (step === "phone" && !emergency) {
      if (phoneKey(data.text).length < 10) {
        await say(tx, conversation.id, pair(language, "I need a phone number with an area code.", "Necesito un teléfono con código de área."));
        return;
      }
      await tx
        .update(receptionistConversations)
        .set({ callerPhone: data.text.trim(), step: "address", updatedAt: new Date() })
        .where(eq(receptionistConversations.id, conversation.id));
      await say(tx, conversation.id, pair(language, "What's the service address?", "¿Cuál es la dirección del servicio?"));
      return;
    }
    if (step === "address" && !emergency) {
      if (data.text.trim().length < 5) {
        await say(tx, conversation.id, pair(language, "I need the street address.", "Necesito la dirección."));
        return;
      }
      await tx
        .update(receptionistConversations)
        .set({ serviceAddress: data.text.trim(), step: "problem", updatedAt: new Date() })
        .where(eq(receptionistConversations.id, conversation.id));
      await say(tx, conversation.id, pair(language, "What's going on?", "¿Qué está pasando?"));
      return;
    }

    if (emergency || step === "problem") {
      const problem = step === "problem" || emergency ? data.text.trim() : conversation.problem;
      conversation = {
        ...conversation,
        problem: problem ?? conversation.problem,
      };
    }

    if (emergency) {
      if (step === "name") conversation = { ...conversation, problem: data.text.trim() };
      if (step === "phone" && phoneKey(data.text).length >= 10) conversation = { ...conversation, callerPhone: data.text.trim(), problem: data.text.trim() };
      if (step === "address") conversation = { ...conversation, serviceAddress: data.text.trim(), problem: data.text.trim() };
      if (step === "problem" || step === "slots") conversation = { ...conversation, problem: data.text.trim() };
      await tx
        .update(receptionistConversations)
        .set({
          callerName: conversation.callerName,
          callerPhone: conversation.callerPhone,
          serviceAddress: conversation.serviceAddress,
          problem: conversation.problem,
          updatedAt: new Date(),
        })
        .where(eq(receptionistConversations.id, conversation.id));
      await escalate(tx, conversation, entityName, settings);
      return;
    }

    if (step === "problem") {
      conversation = { ...conversation, problem: data.text.trim() };
      const intake = await createIntake(tx, conversation, entityName);
      const slots = await openSlots(tx, conversation.entityId, new Date());
      if (!intake) throw new AppError(409, "The request could not be logged.", "invalid_state");
      if (slots.length === 0) {
        await say(
          tx,
          conversation.id,
          pair(
            language,
            "I don't have an open time in the next two weeks. I logged the request and the office will call you.",
            "No tengo un horario libre en las próximas dos semanas. Anoté la solicitud y la oficina le llamará.",
          ),
        );
        await tx
          .update(receptionistConversations)
          .set({
            problem: conversation.problem,
            customerId: intake.customerId,
            propertyId: intake.propertyId,
            requestId: intake.requestId,
            step: "closed",
            outcome: "request_created",
            offeredSlots: [],
            updatedAt: new Date(),
          })
          .where(eq(receptionistConversations.id, conversation.id));
        return;
      }
      await say(tx, conversation.id, slotList(language, slots));
      await tx
        .update(receptionistConversations)
        .set({
          problem: conversation.problem,
          customerId: intake.customerId,
          propertyId: intake.propertyId,
          requestId: intake.requestId,
          step: "slots",
          outcome: "request_created",
          offeredSlots: slots,
          updatedAt: new Date(),
        })
        .where(eq(receptionistConversations.id, conversation.id));
      return;
    }

    if (step === "slots") {
      const index = chosenIndex(data.text);
      const slots = conversation.offeredSlots ?? [];
      const slot = slots.find((item) => item.index === index);
      if (!slot) {
        await say(
          tx,
          conversation.id,
          pair(language, `Reply with the number of the time you want.\n${slotList(language, slots).bodyEn}`, `Responda con el número del horario que quiere.\n${slotList(language, slots).body}`),
        );
        return;
      }
      const booked = await bookSlot(tx, conversation, entityName, slot);
      if (booked.taken) {
        const fresh = await openSlots(tx, conversation.entityId, new Date());
        const notice = pair(
          language,
          "That time was just taken.",
          "Ese horario acaba de ocuparse.",
        );
        await say(tx, conversation.id, fresh.length ? { body: `${notice.body}\n\n${slotList(language, fresh).body}`, bodyEn: `${notice.bodyEn}\n\n${slotList(language, fresh).bodyEn}` } : notice);
        await tx
          .update(receptionistConversations)
          .set({
            step: fresh.length ? "slots" : "closed",
            outcome: fresh.length ? "request_created" : "request_created",
            offeredSlots: fresh,
            updatedAt: new Date(),
          })
          .where(eq(receptionistConversations.id, conversation.id));
      }
    }
  });
  await safeDeliver();
  return loadPublic(conversationId);
}

function publicSettings(
  row: typeof receptionistSettings.$inferSelect,
  entityName: string,
  onCall: { id: string; name: string; phone: string | null } | null,
) {
  return {
    entityId: row.entityId,
    entityName,
    enabled: row.enabled,
    greetingEn: row.greetingEn,
    greetingEs: row.greetingEs,
    hoursStart: row.hoursStart,
    hoursEnd: row.hoursEnd,
    hoursDays: row.hoursDays.map(Number),
    onCallUserId: row.onCallUserId,
    onCallName: onCall?.name ?? null,
    onCallPhone: onCall?.phone ?? null,
    updatedAt: row.updatedAt,
  };
}

async function staffFor(entityId: string) {
  return db
    .select({ id: users.id, name: users.name, phone: users.phone, role: entityMemberships.role })
    .from(entityMemberships)
    .innerJoin(users, eq(users.id, entityMemberships.userId))
    .where(and(eq(entityMemberships.entityId, entityId), eq(users.active, true)))
    .orderBy(asc(users.name));
}

export async function getReceptionistSettings(actor: Actor) {
  assertOffice(actor);
  const settings = await ensureReceptionistSettings(actor.entityId);
  const [entity] = await db.select().from(entities).where(eq(entities.id, actor.entityId));
  if (!entity) throw notFound("Company not found.");
  const staff = await staffFor(actor.entityId);
  const onCall = staff.find((person) => person.id === settings.onCallUserId) ?? null;
  return { data: { ...publicSettings(settings, entity.name, onCall), staff } };
}

const settingsPatch = z.object({
  enabled: z.boolean().optional(),
  greetingEn: z.string().trim().min(1).max(500).optional(),
  greetingEs: z.string().trim().min(1).max(500).optional(),
  hoursStart: z.string().optional(),
  hoursEnd: z.string().optional(),
  hoursDays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
  onCallUserId: z.string().uuid().nullable().optional(),
});

export async function updateReceptionistSettings(actor: Actor, input: unknown) {
  assertOffice(actor);
  const data = parse(settingsPatch, input);
  const current = await ensureReceptionistSettings(actor.entityId);
  const hoursStart = data.hoursStart ?? current.hoursStart;
  const hoursEnd = data.hoursEnd ?? current.hoursEnd;
  if (!clockOk(hoursStart) || !clockOk(hoursEnd) || hoursStart >= hoursEnd) {
    throw new AppError(400, "Business hours need a start before the end, like 08:00 to 17:00.", "invalid_input");
  }
  if (data.onCallUserId) {
    const [member] = await db
      .select({ id: entityMemberships.userId })
      .from(entityMemberships)
      .innerJoin(users, eq(users.id, entityMemberships.userId))
      .where(and(eq(entityMemberships.entityId, actor.entityId), eq(entityMemberships.userId, data.onCallUserId), eq(users.active, true)));
    if (!member) throw new AppError(400, "The on-call person has to belong to this company.", "invalid_on_call");
  }
  const hoursDays = data.hoursDays ? [...new Set(data.hoursDays)].sort((a, b) => a - b) : undefined;
  await db
    .update(receptionistSettings)
    .set({
      enabled: data.enabled ?? current.enabled,
      greetingEn: data.greetingEn ?? current.greetingEn,
      greetingEs: data.greetingEs ?? current.greetingEs,
      hoursStart,
      hoursEnd,
      hoursDays: hoursDays ?? current.hoursDays,
      onCallUserId: data.onCallUserId === undefined ? current.onCallUserId : data.onCallUserId,
      updatedAt: new Date(),
    })
    .where(eq(receptionistSettings.entityId, actor.entityId));
  return getReceptionistSettings(actor);
}

export async function listReceptionistConversations(actor: Actor) {
  assertOffice(actor);
  const rows = await db
    .select({
      id: receptionistConversations.id,
      entityId: receptionistConversations.entityId,
      entityName: entities.name,
      channel: receptionistConversations.channel,
      language: receptionistConversations.language,
      outcome: receptionistConversations.outcome,
      callerName: receptionistConversations.callerName,
      callerPhone: receptionistConversations.callerPhone,
      requestId: receptionistConversations.requestId,
      requestTitle: requests.title,
      createdAt: receptionistConversations.createdAt,
    })
    .from(receptionistConversations)
    .innerJoin(entities, eq(entities.id, receptionistConversations.entityId))
    .leftJoin(requests, eq(requests.id, receptionistConversations.requestId))
    .where(eq(receptionistConversations.entityId, actor.entityId))
    .orderBy(desc(receptionistConversations.createdAt));
  return { data: rows };
}

export async function getReceptionistConversation(actor: Actor, id: string) {
  assertOffice(actor);
  const [row] = await db
    .select({ conversation: receptionistConversations, entityName: entities.name })
    .from(receptionistConversations)
    .innerJoin(entities, eq(entities.id, receptionistConversations.entityId))
    .where(and(eq(receptionistConversations.id, id), eq(receptionistConversations.entityId, actor.entityId)));
  if (!row) throw notFound("Conversation not found.");
  assertActiveBook(actor, row.conversation.entityId);
  const messages = await db
    .select({
      id: receptionistMessages.id,
      role: receptionistMessages.role,
      body: receptionistMessages.body,
      bodyEn: receptionistMessages.bodyEn,
      createdAt: receptionistMessages.createdAt,
    })
    .from(receptionistMessages)
    .where(eq(receptionistMessages.conversationId, id))
    .orderBy(asc(receptionistMessages.createdAt));
  const sandbox = await db
    .select({
      id: receptionistSandboxMessages.id,
      channel: receptionistSandboxMessages.channel,
      kind: receptionistSandboxMessages.kind,
      toPhone: receptionistSandboxMessages.toPhone,
      body: receptionistSandboxMessages.body,
      bodyEn: receptionistSandboxMessages.bodyEn,
      provider: receptionistSandboxMessages.provider,
      delivered: receptionistSandboxMessages.delivered,
      createdAt: receptionistSandboxMessages.createdAt,
    })
    .from(receptionistSandboxMessages)
    .where(and(eq(receptionistSandboxMessages.conversationId, id), eq(receptionistSandboxMessages.entityId, actor.entityId)))
    .orderBy(asc(receptionistSandboxMessages.createdAt));
  return {
    data: {
      conversation: publicConversation(row.conversation, row.entityName),
      messages,
      slots: row.conversation.step === "slots" ? row.conversation.offeredSlots : [],
      sandbox,
    },
  };
}
