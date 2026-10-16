import { actorFromRequest, handle, readJson, search } from "@/lib/http";
import { voidInvoice } from "@adel/core";

export const POST = handle(async (req, { params }) => Response.json(await voidInvoice(await actorFromRequest(req), params.id)));

