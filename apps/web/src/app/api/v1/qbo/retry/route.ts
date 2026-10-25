import { actorFromRequest, handle, readJson } from "@/lib/http";
import { retryQuickBooks } from "@adel/core";

export const POST = handle(async (req) => Response.json(await retryQuickBooks(await actorFromRequest(req), await readJson(req))));
