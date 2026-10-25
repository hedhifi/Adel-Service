import { actorFromRequest, handle, readJson } from "@/lib/http";
import { renewContract } from "@adel/core";

export const POST = handle(async (req, { params }) =>
  Response.json(await renewContract(await actorFromRequest(req), params.id, await readJson(req))),
);
