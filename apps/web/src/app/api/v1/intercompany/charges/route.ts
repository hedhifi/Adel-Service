import { actorFromRequest, handle, readJson, search } from "@/lib/http";
import { createIntercompanyCharge, listIntercompanyCharges } from "@adel/core";

export const GET = handle(async (req) => {
  const params = search(req);
  return Response.json(await listIntercompanyCharges(await actorFromRequest(req), { status: params.get("status") ?? undefined }));
});
export const POST = handle(async (req) => Response.json(await createIntercompanyCharge(await actorFromRequest(req), await readJson(req)), { status: 201 }));
