import { actorFromRequest, handle, readJson, search } from "@/lib/http";
import { disableWebhookEndpoint } from "@adel/core";

export const POST = handle(async (req, { params }) => Response.json(await disableWebhookEndpoint(await actorFromRequest(req), params.id)));

