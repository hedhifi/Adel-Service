import { db } from "@adel/db";
import { sql } from "drizzle-orm";
import { AppError } from "./errors";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function nextNumber(tx: Tx, entityId: string, name: "quote" | "job" | "invoice" | "bill") {
  const result = await tx.execute(sql`
    INSERT INTO counters (entity_id, name, value)
    VALUES (${entityId}, ${name}, 1001)
    ON CONFLICT (entity_id, name)
    DO UPDATE SET value = counters.value + 1
    RETURNING value
  `);
  const rows = result as unknown as Array<{ value: number | string }>;
  const row = rows[0];
  if (!row) throw new AppError(500, "Could not allocate a document number.", "counter_failed");
  return Number(row.value);
}
