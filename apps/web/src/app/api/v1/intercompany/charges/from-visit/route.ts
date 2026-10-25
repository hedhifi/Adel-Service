import { actorFromRequest, handle, readJson } from "@/lib/http";
import { createChargeFromVisit } from "@adel/core";

export const POST = handle(async (req) => Response.json(await createChargeFromVisit(await actorFromRequest(req), await readJson(req)), { status: 201 }));
