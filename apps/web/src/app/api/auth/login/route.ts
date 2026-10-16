import { loginWithPassword } from "@adel/core";
import { handle, readJson, sessionCookie } from "@/lib/http";

export const POST = handle(async (req) => {
  const result = await loginWithPassword(await readJson(req));
  const response = Response.json({ data: result.user });
  response.headers.append("Set-Cookie", sessionCookie(result.token));
  return response;
});

