import { actorFromRequest, handle } from "@/lib/http";
import { syncQuickBooks } from "@adel/core";

export const POST = handle(async (req) => Response.json(await syncQuickBooks(await actorFromRequest(req))));
