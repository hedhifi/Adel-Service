import { actorFromRequest, handle, readJson } from "@/lib/http";
import { generateIntercompanyInvoice } from "@adel/core";

export const POST = handle(async (req) => Response.json(await generateIntercompanyInvoice(await actorFromRequest(req), await readJson(req)), { status: 201 }));
