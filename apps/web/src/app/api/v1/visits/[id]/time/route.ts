import { actorFromRequest, handle, readJson, search } from "@/lib/http";
import { clockVisit } from "@adel/core";

export const POST = handle(async (req, { params }) => Response.json(await clockVisit(await actorFromRequest(req), params.id, await readJson(req))));

