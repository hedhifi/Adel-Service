import { actorFromRequest, handle, readJson, search } from "@/lib/http";
import { listFormTemplates } from "@adel/core";

export const GET = handle(async (req) => Response.json(await listFormTemplates(await actorFromRequest(req))));

