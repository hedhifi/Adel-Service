import { actorFromRequest, handle, readJson, search } from "@/lib/http";
import { sendQuote } from "@adel/core";

export const POST = handle(async (req, { params }) => Response.json(await sendQuote(await actorFromRequest(req), params.id)));

