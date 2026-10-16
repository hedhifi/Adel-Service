import { actorFromRequest, handle, readJson } from "@/lib/http";
import { prepareDictation } from "@adel/core";

export const POST = handle(async (req) => {
  await actorFromRequest(req);
  const body = (await readJson(req)) as { transcript?: unknown };
  return Response.json(await prepareDictation(String(body.transcript ?? "")));
});
