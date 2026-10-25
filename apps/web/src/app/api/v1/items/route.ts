import { actorFromRequest, handle, readJson } from "@/lib/http";
import { createCatalogItem, listCatalogItems } from "@adel/core";

export const GET = handle(async (req) => Response.json(await listCatalogItems(await actorFromRequest(req))));
export const POST = handle(async (req) => Response.json(await createCatalogItem(await actorFromRequest(req), await readJson(req)), { status: 201 }));
