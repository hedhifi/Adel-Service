import { actorFromRequest, handle, readJson, search } from "@/lib/http";
import { createSpeechTerm, listSpeechTerms } from "@adel/core";

export const GET = handle(async (req) => {
  const status = search(req).get("status") ?? undefined;
  return Response.json(await listSpeechTerms(await actorFromRequest(req), { status }));
});

export const POST = handle(async (req) => Response.json(await createSpeechTerm(await actorFromRequest(req), await readJson(req)), { status: 201 }));
