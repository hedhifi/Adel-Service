import { actorFromRequest, handle, readJson, search } from "@/lib/http";
import { bearerSecret, ingestLocations, listLocationTrail } from "@adel/core";

export const POST = handle(async (req) => Response.json(await ingestLocations(await bearerSecret(req.headers.get("authorization")), await readJson(req))));

export const GET = handle(async (req) => {
  const params = search(req);
  return Response.json(
    await listLocationTrail(await actorFromRequest(req), {
      technicianId: params.get("technicianId") ?? undefined,
      day: params.get("day") ?? undefined,
    }),
  );
});
