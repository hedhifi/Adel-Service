import { actorFromRequest, handle, readJson } from "@/lib/http";
import { settleIntercompany } from "@adel/core";

export const POST = handle(async (req) => Response.json(await settleIntercompany(await actorFromRequest(req), await readJson(req))));
