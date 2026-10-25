import { getReceptionistConversation } from "@adel/core";
import { actorFromRequest, handle } from "@/lib/http";

export const GET = handle(async (req, { params }) =>
  Response.json(await getReceptionistConversation(await actorFromRequest(req), params.id)),
);
