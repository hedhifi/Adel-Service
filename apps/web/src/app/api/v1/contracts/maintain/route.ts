import { actorFromRequest, handle } from "@/lib/http";
import { maintainServiceContracts } from "@adel/core";

export const POST = handle(async (req) => Response.json(await maintainServiceContracts(await actorFromRequest(req))));
