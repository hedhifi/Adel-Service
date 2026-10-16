import { handleStripeWebhook } from "@adel/core";
import { AppError } from "@adel/core";

export async function POST(req: Request) {
  try {
    const result = await handleStripeWebhook(await req.text(), req.headers.get("stripe-signature"));
    return Response.json(result);
  } catch (err) {
    if (err instanceof AppError) return Response.json({ error: err.code, message: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : "Webhook rejected.";
    return Response.json({ error: "stripe_webhook", message }, { status: 400 });
  }
}

