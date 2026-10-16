import { actorFromRequest, handle, readJson, search } from "@/lib/http";
import { convertQuote } from "@adel/core";

export const POST = handle(async (req, { params }) => Response.json(await convertQuote(await actorFromRequest(req), params.id)));

