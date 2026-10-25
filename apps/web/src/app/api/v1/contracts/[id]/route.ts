import { actorFromRequest, handle, readJson } from "@/lib/http";
import { getContract, updateContract } from "@adel/core";

export const GET = handle(async (req, { params }) => Response.json(await getContract(await actorFromRequest(req), params.id)));

export const PATCH = handle(async (req, { params }) =>
  Response.json(await updateContract(await actorFromRequest(req), params.id, await readJson(req))),
);
