import { actorFromRequest, handle, readJson } from "@/lib/http";
import { deleteSpeechTerm, updateSpeechTerm } from "@adel/core";

export const PATCH = handle(async (req, { params }) => Response.json(await updateSpeechTerm(await actorFromRequest(req), params.id, await readJson(req))));

export const DELETE = handle(async (req, { params }) => Response.json(await deleteSpeechTerm(await actorFromRequest(req), params.id)));
