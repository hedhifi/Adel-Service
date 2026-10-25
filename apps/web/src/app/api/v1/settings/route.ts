import { actorFromRequest, handle, readJson, search } from "@/lib/http";
import { getCompanySettings, updateCompanySettings } from "@adel/core";


export const GET = handle(async (req) => {
  await actorFromRequest(req);
  return Response.json({ data: await getCompanySettings() });
});
export const PATCH = handle(async (req) => Response.json(await updateCompanySettings(await actorFromRequest(req), await readJson(req))));


