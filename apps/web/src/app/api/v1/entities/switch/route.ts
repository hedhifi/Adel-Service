import { actorFromRequest, handle, readJson } from "@/lib/http";
import { switchEntity } from "@adel/core";

export const POST = handle(async (req) => {
  const body = (await readJson(req)) as { entityId?: string };
  return Response.json(await switchEntity(await actorFromRequest(req), String(body.entityId ?? "")));
});
