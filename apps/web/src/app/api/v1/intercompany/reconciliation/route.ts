import { actorFromRequest, handle } from "@/lib/http";
import { getReconciliation } from "@adel/core";

export const GET = handle(async (req) => Response.json(await getReconciliation(await actorFromRequest(req))));
