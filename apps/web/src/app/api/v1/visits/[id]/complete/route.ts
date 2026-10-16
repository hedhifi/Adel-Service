import { actorFromRequest, handle, readJson, search } from "@/lib/http";
import { completeVisit } from "@adel/core";

export const POST = handle(async (req, { params }) => Response.json(await completeVisit(await actorFromRequest(req), params.id)));

