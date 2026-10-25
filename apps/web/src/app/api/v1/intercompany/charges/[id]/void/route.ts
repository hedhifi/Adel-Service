import { actorFromRequest, handle } from "@/lib/http";
import { voidIntercompanyCharge } from "@adel/core";

export const POST = handle(async (req, { params }) => Response.json(await voidIntercompanyCharge(await actorFromRequest(req), params.id)));
