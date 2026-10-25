import { actorFromRequest, handle } from "@/lib/http";
import { exportBooks } from "@adel/core";

export const GET = handle(async (req) => {
  const url = new URL(req.url);
  const file = await exportBooks(await actorFromRequest(req), {
    report: url.searchParams.get("report") ?? undefined,
    format: url.searchParams.get("format") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    asOf: url.searchParams.get("asOf") ?? undefined,
  });
  return new Response(new Uint8Array(file.body), {
    headers: {
      "content-type": file.contentType,
      "content-disposition": `attachment; filename="${file.filename}"`,
    },
  });
});
