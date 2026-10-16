import { actorFromRequest, handle, readJson, search } from "@/lib/http";
import { approveQuote } from "@adel/core";

export const POST = handle(async (req, { params }) => Response.json(await approveQuote(await actorFromRequest(req), params.id, await readJson(req))));

