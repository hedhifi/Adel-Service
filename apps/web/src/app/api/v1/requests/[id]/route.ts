import { actorFromRequest, handle, readJson, search } from "@/lib/http";
import { getRequest, updateRequest } from "@adel/core";


export const GET = handle(async (req, { params }) => Response.json(await getRequest(await actorFromRequest(req), params.id)));
export const PATCH = handle(async (req, { params }) => Response.json(await updateRequest(await actorFromRequest(req), params.id, await readJson(req))));


