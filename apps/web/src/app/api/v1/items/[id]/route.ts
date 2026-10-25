import { actorFromRequest, handle, readJson } from "@/lib/http";
import { updateCatalogItem } from "@adel/core";

export const PATCH = handle(async (req, { params }) => Response.json(await updateCatalogItem(await actorFromRequest(req), params.id, await readJson(req))));
