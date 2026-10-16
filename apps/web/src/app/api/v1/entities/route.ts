import { actorFromRequest, handle, readJson } from "@/lib/http";
import { renameEntity } from "@adel/core";

export const PATCH = handle(async (req) => Response.json(await renameEntity(await actorFromRequest(req), await readJson(req))));
