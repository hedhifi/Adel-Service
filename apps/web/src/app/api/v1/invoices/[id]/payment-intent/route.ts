import { actorFromRequest, handle, readJson, search } from "@/lib/http";
import { startCardPayment } from "@adel/core";

export const POST = handle(async (req, { params }) => Response.json(await startCardPayment(await actorFromRequest(req), params.id), { status: 201 }));

