import { actorFromRequest, handle } from "@/lib/http";
import { connectQuickBooks } from "@adel/core";

export const POST = handle(async (req) => Response.json(await connectQuickBooks(await actorFromRequest(req))));
