import { brands, companySettings, db } from "@adel/db";
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

export async function listBrands(actor: Actor) {
  if (!actor) throw new AppError(401, "Sign in required.", "unauthenticated");
  const rows = await db.select().from(brands).orderBy(brands.name);
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
    }),
    input,
  );
  const [row] = await db.update(companySettings).set(data).where(eq(companySettings.id, "default")).returning();
  if (!row) throw new AppError(500, "Company settings are missing. Run the seed.", "settings_missing");
  return { data: row };
}
