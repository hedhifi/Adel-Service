import { actorFromRequest, handle, readJson, search } from "@/lib/http";
import { getJob, updateJob } from "@adel/core";


export const GET = handle(async (req, { params }) => Response.json(await getJob(await actorFromRequest(req), params.id)));
export const PATCH = handle(async (req, { params }) => Response.json(await updateJob(await actorFromRequest(req), params.id, await readJson(req))));


