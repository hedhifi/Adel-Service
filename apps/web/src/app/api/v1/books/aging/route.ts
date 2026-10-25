import { actorFromRequest, handle } from "@/lib/http";
import { getBooks } from "@adel/core";

export const GET = handle(async (req) => {
  const url = new URL(req.url);
  const books = await getBooks(await actorFromRequest(req), { asOf: url.searchParams.get("asOf") ?? undefined });
  return Response.json({
    data: {
      companyName: books.data.companyName,
      asOf: books.data.asOf,
      openReceivableCents: books.data.openReceivableCents,
      rows: books.data.aging,
    },
  });
});
