import { actorFromRequest, handle, readJson, search } from "@/lib/http";
import { declineQuote } from "@adel/core";

export const POST = handle(async (req, { params }) => Response.json(await declineQuote(await actorFromRequest(req), params.id, await readJson(req))));

