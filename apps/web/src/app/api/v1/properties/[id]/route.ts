import { actorFromRequest, handle, readJson, search } from "@/lib/http";
import { updateProperty } from "@adel/core";

export const PATCH = handle(async (req, { params }) => Response.json(await updateProperty(await actorFromRequest(req), params.id, await readJson(req))));

