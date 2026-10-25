import { brands, companySettings, db, entities } from "@adel/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { AppError } from "./errors";
import { parse } from "./parse";
import { assertAdmin, type Actor } from "./permissions";

export async function getCompanySettings() {
  const [row] = await db.select().from(companySettings).where(eq(companySettings.id, "default"));
  if (!row) throw new AppError(500, "Company settings are missing. Run the seed.", "settings_missing");
  return row;
}

export async function getEntity(actor: Actor) {
  const [row] = await db.select().from(entities).where(eq(entities.id, actor.entityId));
  if (!row) throw new AppError(500, "That company is missing.", "settings_missing");
  return row;
}

export async function listBrands(actor: Actor) {
  if (!actor) throw new AppError(401, "Sign in required.", "unauthenticated");
  const rows = await db.select().from(brands).where(eq(brands.entityId, actor.entityId)).orderBy(brands.name);
  return { data: rows };
}

export async function updateCompanySettings(actor: Actor, input: unknown) {
  assertAdmin(actor);
  const data = parse(
    z.object({
      legalName: z.string().trim().min(1).max(160),
      timeZone: z.enum(["America/New_York", "America/Chicago"]),
      defaultTaxRateBps: z.number().int().min(0).max(2000),
      taxLabel: z.string().trim().min(1).max(120),
      requireSignatureToComplete: z.boolean(),
      shopAddress: z.string().trim().min(1).max(300),
      trackingStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      trackingEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      locationRetentionDays: z.number().int().min(1).max(3650).optional(),
      reportRemindersEnabled: z.boolean().optional(),
      reportReminderGraceSeconds: z.number().int().min(0).max(3600).optional(),
    }),
    input,
  );
  const { defaultTaxRateBps, taxLabel, ...rest } = data;
  const patch = Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined));
  const [row] = await db.update(companySettings).set(patch).where(eq(companySettings.id, "default")).returning();
  if (!row) throw new AppError(500, "Company settings are missing. Run the seed.", "settings_missing");
  await db
    .update(entities)
    .set({ taxRateBps: defaultTaxRateBps, taxLabel, updatedAt: new Date() })
    .where(eq(entities.id, actor.entityId));
  return { data: { ...row, defaultTaxRateBps, taxLabel } };
}
