import { actorFromRequest, handle, readJson } from "@/lib/http";
import { updateIntercompanyRate } from "@adel/core";

export const PATCH = handle(async (req, { params }) => Response.json(await updateIntercompanyRate(await actorFromRequest(req), params.id, await readJson(req))));
