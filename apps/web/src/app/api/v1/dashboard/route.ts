import { actorFromRequest, handle, readJson, search } from "@/lib/http";
import { getDashboard } from "@adel/core";

export const GET = handle(async (req) => Response.json(await getDashboard(await actorFromRequest(req))));

