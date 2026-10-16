import { actorFromRequest, handle } from "@/lib/http";
import { listNotifications } from "@adel/core";

export const GET = handle(async (req) => Response.json(await listNotifications(await actorFromRequest(req))));
