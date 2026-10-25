import { actorFromRequest, handle, readJson } from "@/lib/http";
import { suggestSpeechTerm } from "@adel/core";

export const POST = handle(async (req) => Response.json(await suggestSpeechTerm(await actorFromRequest(req), await readJson(req)), { status: 201 }));
