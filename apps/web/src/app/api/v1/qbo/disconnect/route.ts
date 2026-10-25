import { actorFromRequest, handle } from "@/lib/http";
import { disconnectQuickBooks } from "@adel/core";

export const POST = handle(async (req) => Response.json(await disconnectQuickBooks(await actorFromRequest(req))));
