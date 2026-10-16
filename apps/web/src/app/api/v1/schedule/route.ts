import { actorFromRequest, handle, readJson, search } from "@/lib/http";
import { getSchedule } from "@adel/core";

export const GET = handle(async (req) => Response.json(await getSchedule(await actorFromRequest(req), search(req).get("day") ?? undefined)));

