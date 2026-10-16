import { readVisitPhoto } from "@adel/core";
import { AppError } from "@adel/core";
import { actorFromRequest } from "@/lib/http";

export async function GET(req: Request, ctx: { params: Promise<{ id: string; photoId: string }> }) {
  try {
    const actor = await actorFromRequest(req);
    const { id, photoId } = await ctx.params;
    const photo = await readVisitPhoto(actor, id, photoId);
    return new Response(new Uint8Array(photo.bytes), { headers: { "content-type": photo.contentType, "cache-control": "private, max-age=3600" } });
  } catch (err) {
    if (err instanceof AppError) return Response.json({ error: err.code, message: err.message }, { status: err.status });
    console.error(err);
    return Response.json({ error: "internal_error", message: "Something went wrong." }, { status: 500 });
  }
}

