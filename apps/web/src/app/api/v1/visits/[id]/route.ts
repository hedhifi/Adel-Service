import { actorFromRequest, handle, readJson, search } from "@/lib/http";
import { getVisit, updateVisit } from "@adel/core";


export const GET = handle(async (req, { params }) => Response.json(await getVisit(await actorFromRequest(req), params.id)));
export const PATCH = handle(async (req, { params }) => Response.json(await updateVisit(await actorFromRequest(req), params.id, await readJson(req))));


