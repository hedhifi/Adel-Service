import { actorFromRequest, handle, readJson } from "@/lib/http";
import { linkCustomers, listEntityLinks } from "@adel/core";

export const GET = handle(async (req) => Response.json(await listEntityLinks(await actorFromRequest(req))));

export const POST = handle(async (req) => Response.json(await linkCustomers(await actorFromRequest(req), await readJson(req)), { status: 201 }));
