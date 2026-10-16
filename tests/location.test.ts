import { customers, db, jobs, notifications, properties, sql, visitNotes, visitPhotos, visits } from "@adel/db";
import { companyToday, zonedDateTime } from "@adel/db/zoned";
import {
  AppError,
  createApiToken,
  getVisit,
  ingestLocations,
  issueDeviceToken,
  listLocationTrail,
  listNotifications,
  processReportReminders,
  purgeOldLocationPoints,
  updateCompanySettings,
  withinTrackingHours,
} from "@adel/core";
import { describe, expect, it } from "vitest";
import { seedCompany } from "./helpers";

const zone = "America/New_York";
let jobSeq = 8000;

async function siteFor(techId: string, adelId: string, latitude: number, longitude: number, status: "scheduled" | "completed" | "canceled" = "scheduled") {
  const [customer] = await db.insert(customers).values({ brandId: adelId, name: "Harbour Client" }).returning();
  const [property] = await db
    .insert(properties)
    .values({
      customerId: customer.id,
      label: "House",
      line1: "1 Bay",
      city: "Naples",
      postalCode: "34102",
      latitude,
      longitude,
    })
    .returning();
  const [job] = await db
    .insert(jobs)
    .values({ number: jobSeq++, customerId: customer.id, propertyId: property.id, brandId: adelId, title: "Service", status: "scheduled" })
    .returning();
  const start = zonedDateTime(companyToday(zone), "10:00", zone);
  const [visit] = await db
    .insert(visits)
    .values({
      jobId: job.id,
      technicianId: techId,
      scheduledStart: start,
      scheduledEnd: new Date(start.getTime() + 2 * 60 * 60 * 1000),
      status,
    })
    .returning();
  return { customer, property, job, visit, start };
}

function point(at: Date, latitude: number, longitude: number) {
  return { recordedAt: at.toISOString(), latitude, longitude, accuracyMeters: 8, batteryPercent: 70 };
}

describe("company phone location", () => {
  it("accepts an acknowledged device token and rejects a user API token", async () => {
    const { admin, tech } = await seedCompany();
    const api = await createApiToken(admin, { name: "Office", role: "office" });
    const issued = await issueDeviceToken(tech, { name: "Phone" });
    const at = zonedDateTime(companyToday(zone), "10:00", zone);
    await expect(ingestLocations(api.secret, { points: [point(at, 26.2, -81.8)] }, at)).rejects.toMatchObject({ status: 401 });
    await expect(ingestLocations(issued.secret, { points: [point(at, 26.2, -81.8)] }, at)).rejects.toMatchObject({
      status: 403,
      code: "notice_required",
    });
    const ready = await issueDeviceToken(tech, { name: "Acknowledged phone", acknowledge: true });
    const result = await ingestLocations(ready.secret, { points: [point(at, 26.2, -81.8)] }, at);
    expect(result.data.stored).toBe(1);
  });

  it("rejects a batch that is missing a timestamp, accuracy, or a sane battery reading", async () => {
    const { tech } = await seedCompany();
    const ready = await issueDeviceToken(tech, { name: "Phone", acknowledge: true });
    const at = zonedDateTime(companyToday(zone), "10:00", zone);
    await expect(ingestLocations(ready.secret, { points: [] }, at)).rejects.toBeInstanceOf(AppError);
    await expect(
      ingestLocations(ready.secret, { points: [{ recordedAt: "nope", latitude: 26, longitude: -81, accuracyMeters: 5, batteryPercent: 10 }] }, at),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      ingestLocations(ready.secret, { points: [{ recordedAt: at.toISOString(), latitude: 95, longitude: -81, accuracyMeters: 5, batteryPercent: 10 }] }, at),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      ingestLocations(ready.secret, { points: [{ recordedAt: at.toISOString(), latitude: 26, longitude: -81, accuracyMeters: -1, batteryPercent: 10 }] }, at),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      ingestLocations(ready.secret, { points: [{ recordedAt: at.toISOString(), latitude: 26, longitude: -81, accuracyMeters: 5, batteryPercent: 140 }] }, at),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("deletes points older than the retention setting", async () => {
    const { admin, tech } = await seedCompany();
    await updateCompanySettings(admin, {
      legalName: "Adel Electric, LLC",
      timeZone: zone,
      defaultTaxRateBps: 700,
      taxLabel: "Estimated Florida sales tax",
      requireSignatureToComplete: true,
      shopAddress: "4180 Enterprise Avenue, Naples, FL 34104",
      locationRetentionDays: 1,
    });
    const ready = await issueDeviceToken(tech, { name: "Phone", acknowledge: true });
    const old = zonedDateTime("2026-10-10", "10:00", zone);
    const fresh = zonedDateTime("2026-10-16", "11:00", zone);
    const result = await ingestLocations(ready.secret, { points: [point(old, 26.2, -81.8), point(fresh, 26.21, -81.8)] }, fresh);
    expect(result.data.stored).toBe(1);
    expect(await purgeOldLocationPoints(fresh)).toBe(0);
    const trail = await listLocationTrail(tech, { day: "2026-10-16" });
    expect(trail.data).toHaveLength(1);
    expect(trail.data[0]?.latitude).toBe(26.21);
  });

  it("keeps points inside tracking hours and skips the rest", async () => {
    const { admin, tech } = await seedCompany();
    await updateCompanySettings(admin, {
      legalName: "Adel Electric, LLC",
      timeZone: zone,
      defaultTaxRateBps: 700,
      taxLabel: "Estimated Florida sales tax",
      requireSignatureToComplete: true,
      shopAddress: "4180 Enterprise Avenue, Naples, FL 34104",
      trackingStart: "09:00",
      trackingEnd: "17:00",
    });
    expect(withinTrackingHours(zonedDateTime("2026-10-16", "08:30", zone), zone, "09:00", "17:00")).toBe(false);
    expect(withinTrackingHours(zonedDateTime("2026-10-16", "09:00", zone), zone, "09:00", "17:00")).toBe(true);
    const ready = await issueDeviceToken(tech, { name: "Phone", acknowledge: true });
    const early = zonedDateTime("2026-10-16", "08:15", zone);
    const open = zonedDateTime("2026-10-16", "10:15", zone);
    const result = await ingestLocations(ready.secret, { points: [point(early, 26.2, -81.8), point(open, 26.21, -81.81)] }, open);
    expect(result.data.stored).toBe(1);
    expect(result.data.skipped).toEqual([expect.objectContaining({ reason: "outside_tracking_hours" })]);
  });

  it("sets on site at arrival and records departure without completing the visit", async () => {
    const { tech, adel } = await seedCompany();
    const { visit } = await siteFor(tech.id, adel.id, 26.2, -81.8);
    const ready = await issueDeviceToken(tech, { name: "Phone", acknowledge: true });
    const arrive = zonedDateTime(companyToday(zone), "10:00", zone);
    const leave = new Date(arrive.getTime() + 20 * 60 * 1000);
    await ingestLocations(ready.secret, { points: [point(arrive, 26.2, -81.8)] }, arrive);
    const onSite = await getVisit(tech, visit.id);
    expect(onSite.data.status).toBe("on_site");
    await ingestLocations(ready.secret, { points: [point(leave, 26.23, -81.8)] }, leave);
    const departed = await getVisit(tech, visit.id);
    expect(departed.data.status).toBe("on_site");
    expect(departed.data.status).not.toBe("completed");
  });

  it("lets the office read a trail and stops a technician from reading another", async () => {
    const { office, tech, otherTech } = await seedCompany();
    const ready = await issueDeviceToken(tech, { name: "Phone", acknowledge: true });
    const at = zonedDateTime(companyToday(zone), "10:30", zone);
    await ingestLocations(ready.secret, { points: [point(at, 26.2, -81.8)] }, at);
    await expect(listLocationTrail(otherTech, { technicianId: tech.id })).rejects.toMatchObject({ status: 403 });
    const own = await listLocationTrail(tech, {});
    const officeView = await listLocationTrail(office, { technicianId: tech.id, day: companyToday(zone) });
    expect(own.data.length).toBe(1);
    expect(officeView.data.length).toBe(1);
  });

  it("reminds once after the grace delay, and not when the report is complete, closed, re-entered, or turned off", async () => {
    const { admin, tech, otherTech, adel } = await seedCompany();
    const ready = await issueDeviceToken(tech, { name: "Phone", acknowledge: true });
    const { visit, customer } = await siteFor(tech.id, adel.id, 26.2, -81.8);
    const arrive = zonedDateTime(companyToday(zone), "11:00", zone);
    const leave = new Date(arrive.getTime() + 15 * 60 * 1000);
    await ingestLocations(ready.secret, { points: [point(arrive, 26.2, -81.8)] }, arrive);
    await ingestLocations(ready.secret, { points: [point(leave, 26.24, -81.8)] }, leave);
    expect(await processReportReminders(new Date(leave.getTime() + 30 * 1000))).toEqual([]);
    const sent = await processReportReminders(new Date(leave.getTime() + 3 * 60 * 1000));
    expect(sent).toEqual([visit.id]);
    expect(await processReportReminders(new Date(leave.getTime() + 10 * 60 * 1000))).toEqual([]);
    const notes = await listNotifications(tech);
    expect(notes.data).toHaveLength(1);
    expect(notes.data[0]?.body).toBe(`You left ${customer.name}. Add what you did and photos?`);
    expect(notes.data[0]?.href).toBe(`/tech/visits/${visit.id}`);
    expect(notes.data[0]?.userId).toBe(tech.id);
    expect((await listNotifications(otherTech)).data).toHaveLength(0);

    const both = await siteFor(tech.id, adel.id, 26.4, -81.8);
    await db.insert(visitNotes).values({ visitId: both.visit.id, authorId: tech.id, body: "Replaced the breaker." });
    await db.insert(visitPhotos).values({
      visitId: both.visit.id,
      authorId: tech.id,
      storageKey: "seed/photo.jpg",
      contentType: "image/jpeg",
    });
    const bothLeave = new Date(arrive.getTime() + 30 * 60 * 1000);
    await ingestLocations(ready.secret, { points: [point(arrive, 26.4, -81.8)] }, arrive);
    await ingestLocations(ready.secret, { points: [point(bothLeave, 26.44, -81.8)] }, bothLeave);
    expect(await processReportReminders(new Date(bothLeave.getTime() + 3 * 60 * 1000))).toEqual([]);

    const done = await siteFor(tech.id, adel.id, 26.5, -81.8, "completed");
    const doneLeave = new Date(arrive.getTime() + 40 * 60 * 1000);
    await ingestLocations(ready.secret, { points: [point(new Date(arrive.getTime() + 35 * 60 * 1000), 26.5, -81.8)] }, arrive);
    await sql`update visits set status = 'completed' where id = ${done.visit.id}`;
    await ingestLocations(ready.secret, { points: [point(doneLeave, 26.54, -81.8)] }, doneLeave);
    expect(await processReportReminders(new Date(doneLeave.getTime() + 3 * 60 * 1000))).not.toContain(done.visit.id);

    const canceled = await siteFor(tech.id, adel.id, 26.6, -81.8, "canceled");
    expect(canceled.visit.status).toBe("canceled");
    await ingestLocations(ready.secret, { points: [point(arrive, 26.6, -81.8)] }, arrive);
    await ingestLocations(ready.secret, { points: [point(doneLeave, 26.64, -81.8)] }, doneLeave);
    expect(await processReportReminders(new Date(doneLeave.getTime() + 3 * 60 * 1000))).not.toContain(canceled.visit.id);

    const returned = await siteFor(tech.id, adel.id, 26.7, -81.8);
    const backLeave = new Date(arrive.getTime() + 50 * 60 * 1000);
    const backIn = new Date(backLeave.getTime() + 30 * 1000);
    await ingestLocations(ready.secret, { points: [point(arrive, 26.7, -81.8)] }, arrive);
    await ingestLocations(ready.secret, { points: [point(backLeave, 26.74, -81.8)] }, backLeave);
    await ingestLocations(ready.secret, { points: [point(backIn, 26.7, -81.8)] }, backIn);
    expect(await processReportReminders(new Date(backLeave.getTime() + 3 * 60 * 1000))).not.toContain(returned.visit.id);

    await updateCompanySettings(admin, {
      legalName: "Adel Electric, LLC",
      timeZone: zone,
      defaultTaxRateBps: 700,
      taxLabel: "Estimated Florida sales tax",
      requireSignatureToComplete: true,
      shopAddress: "4180 Enterprise Avenue, Naples, FL 34104",
      reportRemindersEnabled: false,
    });
    const quiet = await siteFor(tech.id, adel.id, 26.8, -81.8);
    const quietLeave = new Date(arrive.getTime() + 70 * 60 * 1000);
    await ingestLocations(ready.secret, { points: [point(arrive, 26.8, -81.8)] }, arrive);
    await ingestLocations(ready.secret, { points: [point(quietLeave, 26.84, -81.8)] }, quietLeave);
    expect(await processReportReminders(new Date(quietLeave.getTime() + 3 * 60 * 1000))).not.toContain(quiet.visit.id);
    const leftover = (await db.select().from(notifications)).filter((row) => row.userId === tech.id && row.visitId === quiet.visit.id);
    expect(leftover).toHaveLength(0);
  });
});
