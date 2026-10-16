import { actorFromRequest, handle, readJson, search } from "@/lib/http";
import { getQuote, updateQuote } from "@adel/core";


export const GET = handle(async (req, { params }) => Response.json(await getQuote(await actorFromRequest(req), params.id)));
export const PATCH = handle(async (req, { params }) => Response.json(await updateQuote(await actorFromRequest(req), params.id, await readJson(req))));


