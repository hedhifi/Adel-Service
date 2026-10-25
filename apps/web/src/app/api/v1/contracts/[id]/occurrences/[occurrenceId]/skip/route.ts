import { actorFromRequest, handle, readJson } from "@/lib/http";
import { skipContractOccurrence } from "@adel/core";

export const POST = handle(async (req, { params }) =>
  Response.json(await skipContractOccurrence(await actorFromRequest(req), params.id, params.occurrenceId, await readJson(req))),
);
