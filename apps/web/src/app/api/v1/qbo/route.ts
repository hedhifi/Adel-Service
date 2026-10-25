import { actorFromRequest, handle } from "@/lib/http";
import { getQuickBooks } from "@adel/core";

export const GET = handle(async (req) => Response.json(await getQuickBooks(await actorFromRequest(req))));
