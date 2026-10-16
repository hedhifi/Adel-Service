import { actorFromRequest, handle, readJson, search } from "@/lib/http";
import { revokeApiToken } from "@adel/core";

export const POST = handle(async (req, { params }) => Response.json(await revokeApiToken(await actorFromRequest(req), params.id)));

