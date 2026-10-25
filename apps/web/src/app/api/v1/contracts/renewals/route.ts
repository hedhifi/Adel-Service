import { actorFromRequest, handle } from "@/lib/http";
import { listUpcomingRenewals } from "@adel/core";

export const GET = handle(async (req) => {
  const raw = new URL(req.url).searchParams.get("withinDays");
  const withinDays = raw ? Number(raw) : undefined;
  return Response.json(await listUpcomingRenewals(await actorFromRequest(req), withinDays));
});
