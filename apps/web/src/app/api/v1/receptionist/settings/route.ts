import { getReceptionistSettings, updateReceptionistSettings } from "@adel/core";
import { actorFromRequest, handle, readJson } from "@/lib/http";

export const GET = handle(async (req) => Response.json(await getReceptionistSettings(await actorFromRequest(req))));
export const PATCH = handle(async (req) => Response.json(await updateReceptionistSettings(await actorFromRequest(req), await readJson(req))));
