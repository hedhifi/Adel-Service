import { handle } from "@/lib/http";
import { acknowledgeDevice, bearerSecret } from "@adel/core";

export const POST = handle(async (req) => Response.json(await acknowledgeDevice(await bearerSecret(req.headers.get("authorization")))));
