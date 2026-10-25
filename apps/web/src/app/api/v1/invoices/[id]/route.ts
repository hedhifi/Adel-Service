import { actorFromRequest, handle, readJson, search } from "@/lib/http";
import { getInvoice } from "@adel/core";

export const GET = handle(async (req, { params }) => Response.json(await getInvoice(await actorFromRequest(req), params.id)));

