import { actorFromRequest, handle, readJson, search } from "@/lib/http";
import { saveSignature } from "@adel/core";

export const POST = handle(async (req, { params }) => Response.json(await saveSignature(await actorFromRequest(req), params.id, await readJson(req))));

