import { logoutSession } from "@adel/core";
import { clearSessionCookie, handle, readCookie } from "@/lib/http";

export const POST = handle(async (req) => {
  const token = readCookie(req.headers.get("cookie"), "adel_session");
  if (token) await logoutSession(token);
  const response = Response.json({ data: { ok: true } });
  response.headers.append("Set-Cookie", clearSessionCookie());
  return response;
});

