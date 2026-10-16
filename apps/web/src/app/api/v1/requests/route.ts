import { actorFromRequest, handle, readJson, search } from "@/lib/http";
import { createRequest, listRequests } from "@adel/core";


export const GET = handle(async (req) => {
  const params = search(req);
  return Response.json(await listRequests(await actorFromRequest(req), { status: params.get("status") ?? undefined, q: params.get("q") ?? undefined, customerId: params.get("customerId") ?? undefined, limit: params.get("limit") ?? undefined, offset: params.get("offset") ?? undefined }));
});
export const POST = handle(async (req) => Response.json(await createRequest(await actorFromRequest(req), await readJson(req)), { status: 201 }));


