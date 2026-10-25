import { decidePublicQuote } from "@adel/core";
import { AppError } from "@adel/core";

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    const body = await req.json();
    return Response.json(await decidePublicQuote(token, body));
  } catch (err) {
    if (err instanceof AppError) return Response.json({ error: err.code, message: err.message }, { status: err.status });
    return Response.json({ error: "invalid_json", message: "Expected a JSON body." }, { status: 400 });
  }
}

