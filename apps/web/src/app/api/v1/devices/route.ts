import { actorFromRequest, handle, readJson } from "@/lib/http";
import { issueDeviceToken } from "@adel/core";

export const POST = handle(async (req) => Response.json(await issueDeviceToken(await actorFromRequest(req), await readJson(req)), { status: 201 }));
