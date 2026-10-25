import { actorFromRequest, handle, readJson, search } from "@/lib/http";
import { setUserActive } from "@adel/core";

export const PATCH = handle(async (req, { params }) => Response.json(await setUserActive(await actorFromRequest(req), params.id, await readJson(req))));

