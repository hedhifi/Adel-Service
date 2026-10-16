import { actorFromRequest, handle, readJson, search } from "@/lib/http";
import { getCustomer, updateCustomer } from "@adel/core";


export const GET = handle(async (req, { params }) => Response.json(await getCustomer(await actorFromRequest(req), params.id)));
export const PATCH = handle(async (req, { params }) => Response.json(await updateCustomer(await actorFromRequest(req), params.id, await readJson(req))));


