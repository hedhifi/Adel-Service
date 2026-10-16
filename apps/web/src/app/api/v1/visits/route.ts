import { actorFromRequest, handle, readJson, search } from "@/lib/http";
import { listVisits, scheduleVisit } from "@adel/core";


export const GET = handle(async (req) => {
  const params = search(req);
  return Response.json(await listVisits(await actorFromRequest(req), { day: params.get("day") ?? undefined, technicianId: params.get("technicianId") ?? undefined }));
});
export const POST = handle(async (req) => Response.json(await scheduleVisit(await actorFromRequest(req), await readJson(req)), { status: 201 }));


