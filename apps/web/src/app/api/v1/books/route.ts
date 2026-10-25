import { actorFromRequest, handle } from "@/lib/http";
import { getBooks } from "@adel/core";

export const GET = handle(async (req) => {
  const url = new URL(req.url);
  return Response.json(
    await getBooks(await actorFromRequest(req), {
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
      asOf: url.searchParams.get("asOf") ?? undefined,
    }),
  );
});
