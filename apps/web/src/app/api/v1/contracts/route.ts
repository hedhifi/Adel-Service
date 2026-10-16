import { actorFromRequest, handle, readJson } from "@/lib/http";
import { createContract, listContracts } from "@adel/core";

export const GET = handle(async (req) => Response.json(await listContracts(await actorFromRequest(req))));

export const POST = handle(async (req) => Response.json(await createContract(await actorFromRequest(req), await readJson(req)), { status: 201 }));
