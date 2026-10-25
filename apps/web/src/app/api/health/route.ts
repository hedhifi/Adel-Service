import { sql } from "@adel/db";

export async function GET() {
  try {
    await sql`select 1 as ok`;
    return Response.json({ ok: true, service: "adel-service", db: "up" });
  } catch {
    return Response.json({ ok: false, service: "adel-service", db: "down" }, { status: 503 });
  }
}

