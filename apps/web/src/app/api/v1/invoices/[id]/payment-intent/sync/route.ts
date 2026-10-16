import { actorFromRequest, handle, readJson, search } from "@/lib/http";
import { syncCardPayment } from "@adel/core";

export const POST = handle(async (req, { params }) => Response.json(await syncCardPayment(await actorFromRequest(req), params.id, await readJson(req))));

