import { actorFromRequest, handle, readJson } from "@/lib/http";
import { createIntercompanyRate, listIntercompanyRates } from "@adel/core";

export const GET = handle(async (req) => Response.json(await listIntercompanyRates(await actorFromRequest(req))));
export const POST = handle(async (req) => Response.json(await createIntercompanyRate(await actorFromRequest(req), await readJson(req)), { status: 201 }));
