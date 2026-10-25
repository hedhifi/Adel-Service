import { hashSecret, newSecret } from "@adel/db/secrets";
import { companyToday } from "@adel/db/zoned";
import {
  customers,
  db,
  deviceTokens,
  geofenceEvents,
  jobs,
  locationPoints,
  notifications,
  properties,
  timeEntries,
  users,
  visitForms,
  visitNotes,
  visitPhotos,
  visits,
} from "@adel/db";
import { and, asc, desc, eq, isNotNull, isNull, lt, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { AppError } from "./errors";
import { parse } from "./parse";
import { assertOffice, type Actor } from "./permissions";
import { LOCATION_NOTICE } from "./location-notice";
import { getCompanySettings } from "./settings";

export { LOCATION_NOTICE } from "./location-notice";
export const GEOFENCE_RADIUS_METERS = 150;
export const ETA_SPEED_MPH = 30;

const pointSchema = z.object({
  recordedAt: z.string().min(1),
  latitude: z.number().gte(-90).lte(90),
  longitude: z.number().gte(-180).lte(180),
  accuracyMeters: z.number().min(0).max(100000),
  batteryPercent: z.number().int().min(0).max(100),
});

const batchSchema = z.object({
  points: z.array(pointSchema).min(1).max(100),
});

export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function etaMinutes(meters: number) {
  const metersPerMinute = (ETA_SPEED_MPH * 1609.344) / 60;
  return Math.max(1, Math.round(meters / metersPerMinute));
}

function wallMinutes(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  let hour = Number(map.hour);
  if (hour === 24) hour = 0;
  return hour * 60 + Number(map.minute);
}

function parseClock(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function withinTrackingHours(instant: Date, timeZone: string, start: string, end: string) {
  const startMinutes = parseClock(start);
  const endMinutes = parseClock(end);
  if (startMinutes === null || endMinutes === null || startMinutes === endMinutes) return false;
  const minutes = wallMinutes(instant, timeZone);
  if (startMinutes < endMinutes) return minutes >= startMinutes && minutes < endMinutes;
  return minutes >= startMinutes || minutes < endMinutes;
}

function freshness(recordedAt: Date, now: Date) {
  const ageMs = now.getTime() - recordedAt.getTime();
  if (ageMs < 5 * 60 * 1000) return "live";
  if (ageMs < 30 * 60 * 1000) return "recent";
  return "stale";
}

async function deviceFromSecret(secret: string) {
  const [token] = await db.select().from(deviceTokens).where(eq(deviceTokens.tokenHash, hashSecret(secret)));
  if (!token || token.revokedAt) throw new AppError(401, "That device token is not valid.", "unauthenticated");
  const [user] = await db.select().from(users).where(eq(users.id, token.userId));
  if (!user || !user.active || user.role !== "tech") throw new AppError(401, "That device token is not valid.", "unauthenticated");
  return { token, user };
}

export async function issueDeviceToken(actor: Actor, input: unknown) {
  const data = parse(
    z.object({
      name: z.string().trim().min(1).max(80),
      userId: z.string().uuid().optional(),
      acknowledge: z.boolean().optional(),
    }),
    input,
  );
  const userId = data.userId ?? actor.id;
  if (actor.role === "tech" && userId !== actor.id) {
    throw new AppError(403, "A technician can register only their own phone.", "forbidden");
  }
  if (actor.role !== "tech") assertOffice(actor);
  const [tech] = await db.select().from(users).where(eq(users.id, userId));
  if (!tech || tech.role !== "tech" || !tech.active) throw new AppError(400, "Pick an active technician.", "invalid_input");
  const secret = newSecret("adeldev_");
  const [row] = await db
    .insert(deviceTokens)
    .values({
      userId,
      name: data.name,
      tokenHash: hashSecret(secret),
      tokenPrefix: secret.slice(0, 16),
      acknowledgedAt: data.acknowledge ? new Date() : null,
    })
    .returning();
  return { secret, data: { id: row.id, name: row.name, userId: row.userId, acknowledgedAt: row.acknowledgedAt, tokenPrefix: row.tokenPrefix } };
}

export async function acknowledgeDevice(secret: string) {
  const { token } = await deviceFromSecret(secret);
  if (!token.acknowledgedAt) {
    await db.update(deviceTokens).set({ acknowledgedAt: new Date() }).where(eq(deviceTokens.id, token.id));
  }
  return { data: { id: token.id, acknowledged: true } };
}

export async function purgeOldLocationPoints(now = new Date()) {
  const settings = await getCompanySettings();
  const cutoff = new Date(now.getTime() - settings.locationRetentionDays * 24 * 60 * 60 * 1000);
  const removed = await db.delete(locationPoints).where(lt(locationPoints.recordedAt, cutoff)).returning({ id: locationPoints.id });
  return removed.length;
}

async function reportState(visitId: string) {
  const notes = await db.select({ body: visitNotes.body }).from(visitNotes).where(eq(visitNotes.visitId, visitId));
  const photos = await db.select({ id: visitPhotos.id }).from(visitPhotos).where(eq(visitPhotos.visitId, visitId));
  const forms = await db.select({ responses: visitForms.responses }).from(visitForms).where(eq(visitForms.visitId, visitId));
  const times = await db.select({ note: timeEntries.note }).from(timeEntries).where(eq(timeEntries.visitId, visitId));
  const hasText =
    notes.some((note) => note.body.trim()) ||
    times.some((entry) => (entry.note ?? "").trim()) ||
    forms.some((form) => form.responses.some((response) => (response.note ?? "").trim()));
  return { hasText, hasPhotos: photos.length > 0 };
}

async function scheduleReportReminder(visitId: string, departedAt: Date) {
  const settings = await getCompanySettings();
  const [visit] = await db.select().from(visits).where(eq(visits.id, visitId));
  if (!visit || !settings.reportRemindersEnabled) return;
  if (visit.status === "completed" || visit.status === "canceled" || visit.reportRemindedAt || visit.reportReminderDueAt) return;
  const report = await reportState(visitId);
  if (report.hasText && report.hasPhotos) return;
  const due = new Date(departedAt.getTime() + settings.reportReminderGraceSeconds * 1000);
  await db.update(visits).set({ reportReminderDueAt: due, updatedAt: new Date() }).where(eq(visits.id, visitId));
}

async function clearPendingReminder(visitId: string) {
  const [visit] = await db.select().from(visits).where(eq(visits.id, visitId));
  if (!visit || visit.reportRemindedAt || !visit.reportReminderDueAt) return;
  await db.update(visits).set({ reportReminderDueAt: null, updatedAt: new Date() }).where(eq(visits.id, visitId));
}

async function applyGeofence(userId: string, point: { recordedAt: Date; latitude: number; longitude: number }) {
  const settings = await getCompanySettings();
  const day = companyToday(settings.timeZone, point.recordedAt);
  const rows = await db
    .select({
      id: visits.id,
      status: visits.status,
      jobId: jobs.id,
      latitude: properties.latitude,
      longitude: properties.longitude,
      reportRemindedAt: visits.reportRemindedAt,
      reportReminderDueAt: visits.reportReminderDueAt,
    })
    .from(visits)
    .innerJoin(jobs, eq(jobs.id, visits.jobId))
    .innerJoin(properties, eq(properties.id, jobs.propertyId))
    .where(
      and(
        eq(visits.technicianId, userId),
        sql`(${visits.scheduledStart} AT TIME ZONE ${settings.timeZone})::date = ${day}::date`,
      ),
    );
  for (const visit of rows) {
    if (visit.status === "canceled" || visit.latitude === null || visit.longitude === null) continue;
    const inside = distanceMeters(point.latitude, point.longitude, visit.latitude, visit.longitude) <= GEOFENCE_RADIUS_METERS;
    const [last] = await db
      .select()
      .from(geofenceEvents)
      .where(eq(geofenceEvents.visitId, visit.id))
      .orderBy(desc(geofenceEvents.recordedAt))
      .limit(1);
    if (inside && last?.kind !== "arrive") {
      await db.insert(geofenceEvents).values({
        visitId: visit.id,
        userId,
        kind: "arrive",
        recordedAt: point.recordedAt,
        latitude: point.latitude,
        longitude: point.longitude,
      });
      if (visit.status === "scheduled" || visit.status === "en_route") {
        await db.update(visits).set({ status: "on_site", updatedAt: new Date() }).where(eq(visits.id, visit.id));
        await db.update(jobs).set({ status: "in_progress", updatedAt: new Date() }).where(eq(jobs.id, visit.jobId));
      }
      await clearPendingReminder(visit.id);
    } else if (!inside && last?.kind === "arrive") {
      await db.insert(geofenceEvents).values({
        visitId: visit.id,
        userId,
        kind: "depart",
        recordedAt: point.recordedAt,
        latitude: point.latitude,
        longitude: point.longitude,
      });
      await scheduleReportReminder(visit.id, point.recordedAt);
    }
  }
}

export async function processReportReminders(now = new Date()) {
  const settings = await getCompanySettings();
  const due = await db
    .select()
    .from(visits)
    .where(and(isNotNull(visits.reportReminderDueAt), lte(visits.reportReminderDueAt, now), isNull(visits.reportRemindedAt)));
  const sent: string[] = [];
  for (const visit of due) {
    if (!settings.reportRemindersEnabled || visit.status === "completed" || visit.status === "canceled" || !visit.technicianId) {
      await db.update(visits).set({ reportReminderDueAt: null }).where(eq(visits.id, visit.id));
      continue;
    }
    const report = await reportState(visit.id);
    if (report.hasText && report.hasPhotos) {
      await db.update(visits).set({ reportReminderDueAt: null }).where(eq(visits.id, visit.id));
      continue;
    }
    const [context] = await db
      .select({ name: customers.name })
      .from(jobs)
      .innerJoin(customers, eq(customers.id, jobs.customerId))
      .where(eq(jobs.id, visit.jobId));
    const client = context?.name ?? "the job";
    await db.insert(notifications).values({
      userId: visit.technicianId,
      visitId: visit.id,
      body: `You left ${client}. Add what you did and photos?`,
      href: `/tech/visits/${visit.id}`,
      pushStatus: "unavailable",
    });
    await db.update(visits).set({ reportRemindedAt: now, reportReminderDueAt: null, updatedAt: now }).where(eq(visits.id, visit.id));
    sent.push(visit.id);
  }
  return sent;
}

export async function ingestLocations(secret: string, input: unknown, now = new Date()) {
  const data = parse(batchSchema, input);
  const parsed = data.points.map((point) => {
    const recordedAt = new Date(point.recordedAt);
    if (Number.isNaN(recordedAt.getTime())) throw new AppError(400, "Each point needs a timestamp.", "invalid_input");
    if (recordedAt.getTime() > now.getTime() + 24 * 60 * 60 * 1000) {
      throw new AppError(400, "A point is too far in the future.", "invalid_input");
    }
    return { ...point, recordedAt };
  });
  const { token, user } = await deviceFromSecret(secret);
  if (!token.acknowledgedAt) {
    throw new AppError(403, "Tracking starts after you acknowledge the written notice.", "notice_required");
  }
  const settings = await getCompanySettings();
  const cutoff = new Date(now.getTime() - settings.locationRetentionDays * 24 * 60 * 60 * 1000);
  await purgeOldLocationPoints(now);
  const stored = [];
  const skipped = [];
  for (const point of parsed.sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime())) {
    if (point.recordedAt < cutoff) {
      skipped.push({ recordedAt: point.recordedAt.toISOString(), reason: "older_than_retention" });
      continue;
    }
    if (!withinTrackingHours(point.recordedAt, settings.timeZone, settings.trackingStart, settings.trackingEnd)) {
      skipped.push({ recordedAt: point.recordedAt.toISOString(), reason: "outside_tracking_hours" });
      continue;
    }
    const [row] = await db
      .insert(locationPoints)
      .values({
        userId: user.id,
        deviceTokenId: token.id,
        recordedAt: point.recordedAt,
        latitude: point.latitude,
        longitude: point.longitude,
        accuracyMeters: point.accuracyMeters,
        batteryPercent: point.batteryPercent,
      })
      .returning();
    stored.push(row);
    await applyGeofence(user.id, point);
  }
  await purgeOldLocationPoints(now);
  const reminders = await processReportReminders(now);
  return { data: { stored: stored.length, skipped, reminders } };
}

export async function listLocationTrail(actor: Actor, query: { technicianId?: string; day?: string }) {
  const settings = await getCompanySettings();
  const technicianId = query.technicianId ?? actor.id;
  if (actor.role === "tech" && technicianId !== actor.id) {
    throw new AppError(403, "You can see only your own trail.", "forbidden");
  }
  if (actor.role !== "tech") assertOffice(actor);
  const day = query.day ?? companyToday(settings.timeZone);
  const points = await db
    .select()
    .from(locationPoints)
    .where(
      and(
        eq(locationPoints.userId, technicianId),
        sql`(${locationPoints.recordedAt} AT TIME ZONE ${settings.timeZone})::date = ${day}::date`,
      ),
    )
    .orderBy(asc(locationPoints.recordedAt));
  return { data: points };
}

export async function getLiveMap(actor: Actor, now = new Date()) {
  assertOffice(actor);
  await processReportReminders(now);
  const settings = await getCompanySettings();
  const day = companyToday(settings.timeZone, now);
  const techs = await db.select().from(users).where(and(eq(users.role, "tech"), eq(users.active, true))).orderBy(asc(users.name));
  const points = await db
    .select()
    .from(locationPoints)
    .where(sql`(${locationPoints.recordedAt} AT TIME ZONE ${settings.timeZone})::date = ${day}::date`)
    .orderBy(asc(locationPoints.recordedAt));
  const todaysVisits = await db
    .select({
      id: visits.id,
      status: visits.status,
      technicianId: visits.technicianId,
      customerName: customers.name,
      title: jobs.title,
      latitude: properties.latitude,
      longitude: properties.longitude,
      line1: properties.line1,
      city: properties.city,
    })
    .from(visits)
    .innerJoin(jobs, eq(jobs.id, visits.jobId))
    .innerJoin(customers, eq(customers.id, jobs.customerId))
    .innerJoin(properties, eq(properties.id, jobs.propertyId))
    .where(sql`(${visits.scheduledStart} AT TIME ZONE ${settings.timeZone})::date = ${day}::date`);
  const techRows = techs.map((tech) => {
    const trail = points.filter((point) => point.userId === tech.id);
    const last = trail.at(-1) ?? null;
    return {
      id: tech.id,
      name: tech.name,
      last: last
        ? {
            latitude: last.latitude,
            longitude: last.longitude,
            recordedAt: last.recordedAt,
            accuracyMeters: last.accuracyMeters,
            batteryPercent: last.batteryPercent,
            freshness: freshness(last.recordedAt, now),
          }
        : null,
      trail: trail.map((point) => ({ latitude: point.latitude, longitude: point.longitude, recordedAt: point.recordedAt })),
    };
  });
  const jobsToday = todaysVisits
    .filter((visit) => visit.latitude !== null && visit.longitude !== null && visit.status !== "canceled")
    .map((visit) => {
      const tech = techRows.find((row) => row.id === visit.technicianId);
      let eta: number | null = null;
      if (visit.status === "en_route" && tech?.last && visit.latitude !== null && visit.longitude !== null) {
        eta = etaMinutes(distanceMeters(tech.last.latitude, tech.last.longitude, visit.latitude, visit.longitude));
      }
      return {
        visitId: visit.id,
        status: visit.status,
        customerName: visit.customerName,
        title: visit.title,
        technicianId: visit.technicianId,
        latitude: visit.latitude,
        longitude: visit.longitude,
        line1: visit.line1,
        city: visit.city,
        etaMinutes: eta,
      };
    });
  return {
    data: {
      day,
      timeZone: settings.timeZone,
      radiusMeters: GEOFENCE_RADIUS_METERS,
      notice: LOCATION_NOTICE.counselLabel,
      techs: techRows,
      jobs: jobsToday,
    },
  };
}

export async function listNotifications(actor: Actor) {
  await processReportReminders();
  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, actor.id))
    .orderBy(desc(notifications.createdAt));
  return { data: rows };
}

export async function bearerSecret(header: string | null) {
  const match = /^Bearer\s+(\S+)$/i.exec(header?.trim() ?? "");
  if (!match) throw new AppError(401, "Use a device token.", "unauthenticated");
  return match[1];
}
