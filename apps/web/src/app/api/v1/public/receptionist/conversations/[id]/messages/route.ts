import { postReceptionistMessage } from "@adel/core";
import { handle, readJson } from "@/lib/http";

export const POST = handle(async (req, { params }) =>
  Response.json(await postReceptionistMessage(params.id, await readJson(req))),
);
