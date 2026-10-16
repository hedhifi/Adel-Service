import { actorFromRequest, handle, readJson, search } from "@/lib/http";
import { addVisitNote } from "@adel/core";

export const POST = handle(async (req, { params }) => Response.json(await addVisitNote(await actorFromRequest(req), params.id, await readJson(req)), { status: 201 }));

