import { actorFromRequest } from "@/lib/http";
import { AppError, completeSandboxOAuth } from "@adel/core";

export async function GET(req: Request) {
  const url = new URL(req.url);
  try {
    await completeSandboxOAuth(await actorFromRequest(req), {
      code: url.searchParams.get("code"),
      state: url.searchParams.get("state"),
      realmId: url.searchParams.get("realmId"),
    });
    return Response.redirect(new URL("/books?notice=QuickBooks+sandbox+connected", url.origin));
  } catch (err) {
    const message = err instanceof AppError ? err.message : "QuickBooks connection failed.";
    return Response.redirect(new URL(`/books?error=${encodeURIComponent(message)}`, url.origin));
  }
}
