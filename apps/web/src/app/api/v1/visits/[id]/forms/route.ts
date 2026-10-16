import { actorFromRequest, handle, readJson, search } from "@/lib/http";
import { addVisitForm } from "@adel/core";

export const POST = handle(async (req, { params }) => Response.json(await addVisitForm(await actorFromRequest(req), params.id, await readJson(req)), { status: 201 }));

