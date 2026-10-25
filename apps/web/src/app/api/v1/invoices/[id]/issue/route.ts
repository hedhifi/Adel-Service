import { actorFromRequest, handle, readJson, search } from "@/lib/http";
import { issueInvoice } from "@adel/core";

export const POST = handle(async (req, { params }) => Response.json(await issueInvoice(await actorFromRequest(req), params.id)));

