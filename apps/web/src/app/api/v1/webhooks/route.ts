import { actorFromRequest, handle, readJson, search } from "@/lib/http";
import { createWebhookEndpoint, listWebhookEndpoints } from "@adel/core";


export const GET = handle(async (req) => Response.json(await listWebhookEndpoints(await actorFromRequest(req))));
export const POST = handle(async (req) => Response.json(await createWebhookEndpoint(await actorFromRequest(req), await readJson(req)), { status: 201 }));


