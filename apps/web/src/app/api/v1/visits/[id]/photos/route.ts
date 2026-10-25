import { actorFromRequest, handle } from "@/lib/http";
import { AppError, addVisitPhoto } from "@adel/core";


export const POST = handle(async (req, { params }) => {
  const actor = await actorFromRequest(req);
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new AppError(400, "Choose a photo.", "invalid_file");
  const result = await addVisitPhoto(actor, params.id, {
    bytes: Buffer.from(await file.arrayBuffer()),
    contentType: file.type,
    caption: String(form.get("caption") ?? ""),
    rawCaption: String(form.get("rawCaption") ?? ""),
  });
  return Response.json(result, { status: 201 });
});


