import { startReceptionistConversation } from "@adel/core";
import { handle, readJson } from "@/lib/http";

export const POST = handle(async (req) => Response.json(await startReceptionistConversation(await readJson(req)), { status: 201 }));
