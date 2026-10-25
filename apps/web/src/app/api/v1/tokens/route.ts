import { actorFromRequest, handle, readJson, search } from "@/lib/http";
import { createApiToken, listApiTokens } from "@adel/core";


export const GET = handle(async (req) => Response.json(await listApiTokens(await actorFromRequest(req))));
export const POST = handle(async (req) => Response.json(await createApiToken(await actorFromRequest(req), await readJson(req)), { status: 201 }));


