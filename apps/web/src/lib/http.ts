import { AppError, authenticateBearer, authenticateSessionToken, type Actor } from "@adel/core";

export function readCookie(header: string | null, name: string) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export async function actorFromRequest(req: Request): Promise<Actor> {
  const header = req.headers.get("authorization");
  if (header) return authenticateBearer(header);
  const token = readCookie(req.headers.get("cookie"), "adel_session");
  if (!token) throw new AppError(401, "Sign in required.", "unauthenticated");
  const actor = await authenticateSessionToken(token);
  if (!actor) throw new AppError(401, "Session expired.", "unauthenticated");
  return actor;
}

export async function readJson(req: Request) {
  const text = await req.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AppError(400, "Expected a JSON body.", "invalid_json");
  }
}

export function handle(fn: (req: Request, ctx: { params: Record<string, string> }) => Promise<Response>) {
  return async (req: Request, routeCtx: { params: Promise<Record<string, string>> }) => {
    try {
      const params = routeCtx?.params ? await routeCtx.params : {};
      return await fn(req, { params });
    } catch (err) {
      if (err instanceof AppError) {
        return Response.json({ error: err.code, message: err.message }, { status: err.status });
      }
      console.error(err);
      return Response.json({ error: "internal_error", message: "Something went wrong." }, { status: 500 });
    }
  };
}

export function sessionCookie(token: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `adel_session=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=1209600; SameSite=Lax${secure}`;
}

export function clearSessionCookie() {
  return "adel_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax";
}

export function search(req: Request) {
  return new URL(req.url).searchParams;
}
