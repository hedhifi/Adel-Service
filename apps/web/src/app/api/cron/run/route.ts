import { handle } from "@/lib/http";
import { assertCronAuthorized, runScheduledJobs } from "@adel/core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = handle(async (req) => {
  assertCronAuthorized(req.headers.get("authorization"));
  const result = await runScheduledJobs();
  return Response.json({ ok: true, ...result });
});
