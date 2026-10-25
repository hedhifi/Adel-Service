import { catalogItems, db } from "@adel/db";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { AppError, notFound } from "./errors";
import { isUniqueViolation, parse } from "./parse";
import { assertOffice, type Actor } from "./permissions";
import { afterBooksChange } from "./qbo/sync";

const itemInput = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).optional().nullable(),
  kind: z.enum(["labor", "material", "other"]).default("other"),
  sku: z.string().trim().max(80).optional().nullable(),
  unitAmountCents: z.number().int().min(0).max(10_000_000),
  taxable: z.boolean().default(false),
  active: z.boolean().optional(),
});

function present(row: typeof catalogItems.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    kind: row.kind,
    sku: row.sku,
    unitAmountCents: row.unitAmountCents,
    taxable: row.taxable,
    active: row.active,
    updatedAt: row.updatedAt,
  };
}

export async function listCatalogItems(actor: Actor) {
  assertOffice(actor);
  const rows = await db.select().from(catalogItems).where(eq(catalogItems.entityId, actor.entityId)).orderBy(asc(catalogItems.name));
  return { data: rows.map(present) };
}

export async function createCatalogItem(actor: Actor, input: unknown) {
  assertOffice(actor);
  const data = parse(itemInput, input);
  try {
    const [row] = await db
      .insert(catalogItems)
      .values({
        entityId: actor.entityId,
        name: data.name,
        description: data.description ?? null,
        kind: data.kind,
        sku: data.sku || null,
        unitAmountCents: data.unitAmountCents,
        taxable: data.taxable,
        active: data.active ?? true,
      })
      .returning();
    await afterBooksChange(actor.entityId);
    return { data: present(row) };
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError(409, "This company already has an item with that name.", "conflict");
    throw err;
  }
}

export async function updateCatalogItem(actor: Actor, id: string, input: unknown) {
  assertOffice(actor);
  const data = parse(itemInput.partial(), input);
  const [existing] = await db.select().from(catalogItems).where(and(eq(catalogItems.id, id), eq(catalogItems.entityId, actor.entityId)));
  if (!existing) throw notFound("Item not found.");
  try {
    const [row] = await db
      .update(catalogItems)
      .set({
        name: data.name ?? existing.name,
        description: data.description === undefined ? existing.description : data.description,
        kind: data.kind ?? existing.kind,
        sku: data.sku === undefined ? existing.sku : data.sku || null,
        unitAmountCents: data.unitAmountCents ?? existing.unitAmountCents,
        taxable: data.taxable ?? existing.taxable,
        active: data.active ?? existing.active,
        updatedAt: new Date(),
      })
      .where(eq(catalogItems.id, id))
      .returning();
    await afterBooksChange(actor.entityId);
    return { data: present(row) };
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError(409, "This company already has an item with that name.", "conflict");
    throw err;
  }
}
