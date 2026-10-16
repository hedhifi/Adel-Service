import { actorFromRequest, handle, readJson, search } from "@/lib/http";
import { saveVisitForm } from "@adel/core";

export const PUT = handle(async (req, { params }) => Response.json(await saveVisitForm(await actorFromRequest(req), params.id, params.formId, await readJson(req))));

