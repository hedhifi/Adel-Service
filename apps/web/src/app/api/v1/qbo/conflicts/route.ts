import { actorFromRequest, handle, readJson } from "@/lib/http";
import { listQuickBooksConflicts, resolveQuickBooksConflict } from "@adel/core";

export const GET = handle(async (req) => Response.json(await listQuickBooksConflicts(await actorFromRequest(req))));
export const POST = handle(async (req) => Response.json(await resolveQuickBooksConflict(await actorFromRequest(req), await readJson(req))));
