import { actorFromRequest, handle, readJson, search } from "@/lib/http";
import { recordManualPayment } from "@adel/core";

export const POST = handle(async (req, { params }) => Response.json(await recordManualPayment(await actorFromRequest(req), params.id, await readJson(req)), { status: 201 }));

