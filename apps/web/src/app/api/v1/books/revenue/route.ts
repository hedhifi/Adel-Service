import { actorFromRequest, handle } from "@/lib/http";
import { getBooks } from "@adel/core";

export const GET = handle(async (req) => {
  const url = new URL(req.url);
  const books = await getBooks(await actorFromRequest(req), {
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
  });
  return Response.json({
    data: { companyName: books.data.companyName, rows: books.data.revenue, revenueThisMonthCents: books.data.revenueThisMonthCents },
  });
});
