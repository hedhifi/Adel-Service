import { actorFromRequest, handle, readJson, search } from "@/lib/http";
import { createInvoice, listInvoices } from "@adel/core";


export const GET = handle(async (req) => {
  const params = search(req);
  return Response.json(await listInvoices(await actorFromRequest(req), { status: params.get("status") ?? undefined, customerId: params.get("customerId") ?? undefined }));
});
export const POST = handle(async (req) => Response.json(await createInvoice(await actorFromRequest(req), await readJson(req)), { status: 201 }));


