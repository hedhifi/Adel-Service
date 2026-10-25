import { actorFromRequest, handle, readJson } from "@/lib/http";
import { createContractSchedule } from "@adel/core";

export const POST = handle(async (req, { params }) =>
  Response.json(await createContractSchedule(await actorFromRequest(req), params.id, await readJson(req)), { status: 201 }),
);
