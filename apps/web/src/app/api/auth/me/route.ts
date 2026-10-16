import { handle, actorFromRequest } from "@/lib/http";

export const GET = handle(async (req) => {
  const actor = await actorFromRequest(req);
  return Response.json({ data: actor });
});

