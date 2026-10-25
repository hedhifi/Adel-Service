import { actorFromRequest, handle, readJson, search } from "@/lib/http";
import { createProperty } from "@adel/core";

export const POST = handle(async (req, { params }) => Response.json(await createProperty(await actorFromRequest(req), params.id, await readJson(req)), { status: 201 }));

