import { actorFromRequest, handle, readJson, search } from "@/lib/http";
import { createQuote, listQuotes } from "@adel/core";


export const GET = handle(async (req) => {
  const params = search(req);
  return Response.json(await listQuotes(await actorFromRequest(req), { status: params.get("status") ?? undefined, q: params.get("q") ?? undefined, customerId: params.get("customerId") ?? undefined }));
});
export const POST = handle(async (req) => Response.json(await createQuote(await actorFromRequest(req), await readJson(req)), { status: 201 }));


