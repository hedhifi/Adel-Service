import { actorFromRequest, handle } from "@/lib/http";
import { cancelContract } from "@adel/core";

export const POST = handle(async (req, { params }) => Response.json(await cancelContract(await actorFromRequest(req), params.id)));
