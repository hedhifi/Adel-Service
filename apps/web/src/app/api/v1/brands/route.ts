import { actorFromRequest, handle, readJson, search } from "@/lib/http";
import { listBrands } from "@adel/core";

export const GET = handle(async (req) => Response.json(await listBrands(await actorFromRequest(req))));

