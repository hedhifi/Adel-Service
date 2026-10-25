import { storageHealth, stripeMode } from "@adel/core";
import { log } from "@adel/core";
import { sql } from "@adel/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const started = Date.now();
  let db: "up" | "down" = "down";
  try {
    await sql`select 1 as ok`;
    db = "up";
  } catch (err) {
    log("error", "readiness database check failed", { message: err instanceof Error ? err.message : "unknown" });
  }

  const storage = await storageHealth();
  let stripe: "test" | "unconfigured" | "refused" = "unconfigured";
  try {
    stripe = stripeMode();
  } catch (err) {
    stripe = "refused";
    log("error", "stripe configuration refused", { message: err instanceof Error ? err.message : "unknown" });
  }

  const ok = db === "up" && storage.ok && stripe !== "refused";
  return Response.json(
    {
      ok,
      service: "adel-service",
      db,
      storage: storage.detail,
      stripe,
      uptimeSeconds: Math.round(process.uptime()),
      latencyMs: Date.now() - started,
    },
    { status: ok ? 200 : 503 },
  );
}
