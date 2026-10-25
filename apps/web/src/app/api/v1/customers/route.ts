import { actorFromRequest, handle, readJson, search } from "@/lib/http";
import { createCustomer, listCustomers } from "@adel/core";


export const GET = handle(async (req) => {
  const params = search(req);
  return Response.json(await listCustomers(await actorFromRequest(req), { q: params.get("q") ?? undefined, limit: params.get("limit") ?? undefined, offset: params.get("offset") ?? undefined }));
});
export const POST = handle(async (req) => Response.json(await createCustomer(await actorFromRequest(req), await readJson(req)), { status: 201 }));


