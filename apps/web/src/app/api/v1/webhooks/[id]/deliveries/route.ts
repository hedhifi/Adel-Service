import { actorFromRequest, handle, readJson, search } from "@/lib/http";
import { listWebhookDeliveries } from "@adel/core";

export const GET = handle(async (req, { params }) => Response.json(await listWebhookDeliveries(await actorFromRequest(req), params.id)));

