import { actorFromRequest, handle } from "@/lib/http";
import { listQuickBooksLog } from "@adel/core";

export const GET = handle(async (req) => Response.json(await listQuickBooksLog(await actorFromRequest(req))));
