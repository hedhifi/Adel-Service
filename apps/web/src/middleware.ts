import { NextResponse, type NextRequest } from "next/server";

const PUBLIC = [
  /^\/login$/,
  /^\/q\//,
  /^\/api\/auth\/login$/,
  /^\/api\/health(\/.*)?$/,
  /^\/offline\.html$/,
  /^\/api\/openapi$/,
  /^\/api\/v1\/public\//,
  /^\/api\/stripe\/webhook$/,
  /^\/manifest\.webmanifest$/,
  /^\/sw\.js$/,
  /^\/favicon\.svg$/,
  /^\/icons\//,
];

export function middleware(req: NextRequest) {
  const secure = (process.env.APP_URL ?? "").startsWith("https://") || req.headers.get("x-forwarded-proto") === "https";
  const finishRequest = (response: NextResponse) => {
    if (secure) response.headers.set("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
    return response;
  };

  const { pathname } = req.nextUrl;
  if (PUBLIC.some((pattern) => pattern.test(pathname))) return finishRequest(NextResponse.next());

  if (pathname.startsWith("/api/")) {
    const header = req.headers.get("authorization");
    const session = req.cookies.get("adel_session");
    if (!header && !session) {
      return finishRequest(NextResponse.json({ error: "unauthenticated", message: "Sign in required." }, { status: 401 }));
    }
    return finishRequest(NextResponse.next());
  }

  if (!req.cookies.get("adel_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return finishRequest(NextResponse.redirect(url));
  }
  return finishRequest(NextResponse.next());
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
