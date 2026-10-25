import { NextResponse, type NextRequest } from "next/server";

const PUBLIC = [
  /^\/login$/,
  /^\/q\//,
  /^\/api\/auth\/login$/,
  /^\/api\/health$/,
  /^\/api\/openapi$/,
  /^\/api\/v1\/public\//,
  /^\/api\/stripe\/webhook$/,
  /^\/manifest\.webmanifest$/,
  /^\/sw\.js$/,
  /^\/favicon\.svg$/,
  /^\/icons\//,
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((pattern) => pattern.test(pathname))) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    const header = req.headers.get("authorization");
    const session = req.cookies.get("adel_session");
    if (!header && !session) {
      return NextResponse.json({ error: "unauthenticated", message: "Sign in required." }, { status: 401 });
    }
    return NextResponse.next();
  }

  if (!req.cookies.get("adel_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
