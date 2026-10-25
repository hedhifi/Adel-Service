import { actorFromRequest, handle, readJson } from "@/lib/http";
import { updateContractSchedule } from "@adel/core";

export const PATCH = handle(async (req, { params }) =>
  Response.json(await updateContractSchedule(await actorFromRequest(req), params.id, params.scheduleId, await readJson(req))),
);
