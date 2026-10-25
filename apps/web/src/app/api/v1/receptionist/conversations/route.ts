import { listReceptionistConversations } from "@adel/core";
import { actorFromRequest, handle } from "@/lib/http";

export const GET = handle(async (req) => Response.json(await listReceptionistConversations(await actorFromRequest(req))));
