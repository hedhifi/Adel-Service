import { getPublicQuote } from "@adel/core";
import { AppError } from "@adel/core";

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    return Response.json(await getPublicQuote(token));
  } catch (err) {
    if (err instanceof AppError) return Response.json({ error: err.code, message: err.message }, { status: err.status });
    throw err;
  }
}

