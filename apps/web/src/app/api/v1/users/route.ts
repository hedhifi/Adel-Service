import { actorFromRequest, handle, readJson, search } from "@/lib/http";
import { createUser, listUsers } from "@adel/core";


export const GET = handle(async (req) => Response.json(await listUsers(await actorFromRequest(req))));
export const POST = handle(async (req) => Response.json(await createUser(await actorFromRequest(req), await readJson(req)), { status: 201 }));


