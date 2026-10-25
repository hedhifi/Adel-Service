import { actorFromRequest, handle } from "@/lib/http";
import { getLiveMap } from "@adel/core";

export const GET = handle(async (req) => Response.json(await getLiveMap(await actorFromRequest(req))));
