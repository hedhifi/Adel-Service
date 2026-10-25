import { actorFromRequest, handle } from "@/lib/http";
import { exportEntity } from "@adel/core";

export const GET = handle(async (req) => Response.json(await exportEntity(await actorFromRequest(req))));
