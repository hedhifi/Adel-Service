import fs from "node:fs";
import path from "node:path";

const root = path.resolve("apps/web/src/app/api");

function write(rel, source) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, source.trimStart() + "\n");
}

const common = `import { actorFromRequest, handle, readJson, search } from "@/lib/http";`;

write(
  "health/route.ts",
  `
import { sql } from "@adel/db";

export async function GET() {
  try {
    await sql\`select 1 as ok\`;
    return Response.json({ ok: true, service: "adel-service", db: "up" });
  } catch {
    return Response.json({ ok: false, service: "adel-service", db: "down" }, { status: 503 });
  }
}
`,
);

write(
  "openapi/route.ts",
  `
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export function GET() {
  const candidates = [
    path.resolve(process.cwd(), "openapi/openapi.json"),
    path.resolve(process.cwd(), "../../openapi/openapi.json"),
  ];
  const file = candidates.find((candidate) => existsSync(candidate));
  if (!file) return Response.json({ error: "not_found", message: "API spec is missing." }, { status: 404 });
  return new Response(readFileSync(file, "utf8"), {
    headers: { "content-type": "application/json" },
  });
}
`,
);

write(
  "auth/login/route.ts",
  `
import { loginWithPassword } from "@adel/core";
import { handle, readJson, sessionCookie } from "@/lib/http";

export const POST = handle(async (req) => {
  const result = await loginWithPassword(await readJson(req));
  const response = Response.json({ data: result.user });
  response.headers.append("Set-Cookie", sessionCookie(result.token));
  return response;
});
`,
);

write(
  "auth/logout/route.ts",
  `
import { logoutSession } from "@adel/core";
import { clearSessionCookie, handle, readCookie } from "@/lib/http";

export const POST = handle(async (req) => {
  const token = readCookie(req.headers.get("cookie"), "adel_session");
  if (token) await logoutSession(token);
  const response = Response.json({ data: { ok: true } });
  response.headers.append("Set-Cookie", clearSessionCookie());
  return response;
});
`,
);

write(
  "auth/me/route.ts",
  `
import { handle, actorFromRequest } from "@/lib/http";

export const GET = handle(async (req) => {
  const actor = await actorFromRequest(req);
  return Response.json({ data: actor });
});
`,
);

write(
  "stripe/webhook/route.ts",
  `
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
`,
);

function jsonRoute(imports, methods) {
  return `${common}\n${imports}\n\n${methods}\n`;
}

write(
  "v1/brands/route.ts",
  jsonRoute(`import { listBrands } from "@adel/core";`, `export const GET = handle(async (req) => Response.json(await listBrands(await actorFromRequest(req))));`),
);

write(
  "v1/customers/route.ts",
  jsonRoute(
    `import { createCustomer, listCustomers } from "@adel/core";`,
    `
export const GET = handle(async (req) => {
  const params = search(req);
  return Response.json(await listCustomers(await actorFromRequest(req), { q: params.get("q") ?? undefined, limit: params.get("limit") ?? undefined, offset: params.get("offset") ?? undefined }));
});
export const POST = handle(async (req) => Response.json(await createCustomer(await actorFromRequest(req), await readJson(req)), { status: 201 }));
`,
  ),
);

write(
  "v1/customers/[id]/route.ts",
  jsonRoute(
    `import { getCustomer, updateCustomer } from "@adel/core";`,
    `
export const GET = handle(async (req, { params }) => Response.json(await getCustomer(await actorFromRequest(req), params.id)));
export const PATCH = handle(async (req, { params }) => Response.json(await updateCustomer(await actorFromRequest(req), params.id, await readJson(req))));
`,
  ),
);

write(
  "v1/customers/[id]/properties/route.ts",
  jsonRoute(
    `import { createProperty } from "@adel/core";`,
    `export const POST = handle(async (req, { params }) => Response.json(await createProperty(await actorFromRequest(req), params.id, await readJson(req)), { status: 201 }));`,
  ),
);

write(
  "v1/properties/[id]/route.ts",
  jsonRoute(
    `import { updateProperty } from "@adel/core";`,
    `export const PATCH = handle(async (req, { params }) => Response.json(await updateProperty(await actorFromRequest(req), params.id, await readJson(req))));`,
  ),
);

write(
  "v1/requests/route.ts",
  jsonRoute(
    `import { createRequest, listRequests } from "@adel/core";`,
    `
export const GET = handle(async (req) => {
  const params = search(req);
  return Response.json(await listRequests(await actorFromRequest(req), { status: params.get("status") ?? undefined, q: params.get("q") ?? undefined, customerId: params.get("customerId") ?? undefined, limit: params.get("limit") ?? undefined, offset: params.get("offset") ?? undefined }));
});
export const POST = handle(async (req) => Response.json(await createRequest(await actorFromRequest(req), await readJson(req)), { status: 201 }));
`,
  ),
);

write(
  "v1/requests/[id]/route.ts",
  jsonRoute(
    `import { getRequest, updateRequest } from "@adel/core";`,
    `
export const GET = handle(async (req, { params }) => Response.json(await getRequest(await actorFromRequest(req), params.id)));
export const PATCH = handle(async (req, { params }) => Response.json(await updateRequest(await actorFromRequest(req), params.id, await readJson(req))));
`,
  ),
);

write(
  "v1/quotes/route.ts",
  jsonRoute(
    `import { createQuote, listQuotes } from "@adel/core";`,
    `
export const GET = handle(async (req) => {
  const params = search(req);
  return Response.json(await listQuotes(await actorFromRequest(req), { status: params.get("status") ?? undefined, q: params.get("q") ?? undefined, customerId: params.get("customerId") ?? undefined }));
});
export const POST = handle(async (req) => Response.json(await createQuote(await actorFromRequest(req), await readJson(req)), { status: 201 }));
`,
  ),
);

write(
  "v1/quotes/[id]/route.ts",
  jsonRoute(
    `import { getQuote, updateQuote } from "@adel/core";`,
    `
export const GET = handle(async (req, { params }) => Response.json(await getQuote(await actorFromRequest(req), params.id)));
export const PATCH = handle(async (req, { params }) => Response.json(await updateQuote(await actorFromRequest(req), params.id, await readJson(req))));
`,
  ),
);

for (const [action, fn] of [
  ["send", "sendQuote"],
  ["approve", "approveQuote"],
  ["decline", "declineQuote"],
  ["convert", "convertQuote"],
]) {
  const args = action === "send" || action === "convert" ? "params.id" : "params.id, await readJson(req)";
  write(
    `v1/quotes/[id]/${action}/route.ts`,
    jsonRoute(
      `import { ${fn} } from "@adel/core";`,
      `export const POST = handle(async (req, { params }) => Response.json(await ${fn}(await actorFromRequest(req), ${args})));`,
    ),
  );
}

write(
  "v1/jobs/route.ts",
  jsonRoute(
    `import { createJob, listJobs } from "@adel/core";`,
    `
export const GET = handle(async (req) => {
  const params = search(req);
  return Response.json(await listJobs(await actorFromRequest(req), { status: params.get("status") ?? undefined, q: params.get("q") ?? undefined, customerId: params.get("customerId") ?? undefined }));
});
export const POST = handle(async (req) => Response.json(await createJob(await actorFromRequest(req), await readJson(req)), { status: 201 }));
`,
  ),
);

write(
  "v1/jobs/[id]/route.ts",
  jsonRoute(
    `import { getJob, updateJob } from "@adel/core";`,
    `
export const GET = handle(async (req, { params }) => Response.json(await getJob(await actorFromRequest(req), params.id)));
export const PATCH = handle(async (req, { params }) => Response.json(await updateJob(await actorFromRequest(req), params.id, await readJson(req))));
`,
  ),
);

write(
  "v1/schedule/route.ts",
  jsonRoute(
    `import { getSchedule } from "@adel/core";`,
    `export const GET = handle(async (req) => Response.json(await getSchedule(await actorFromRequest(req), search(req).get("day") ?? undefined)));`,
  ),
);

write(
  "v1/visits/route.ts",
  jsonRoute(
    `import { listVisits, scheduleVisit } from "@adel/core";`,
    `
export const GET = handle(async (req) => {
  const params = search(req);
  return Response.json(await listVisits(await actorFromRequest(req), { day: params.get("day") ?? undefined, technicianId: params.get("technicianId") ?? undefined }));
});
export const POST = handle(async (req) => Response.json(await scheduleVisit(await actorFromRequest(req), await readJson(req)), { status: 201 }));
`,
  ),
);

write(
  "v1/visits/[id]/route.ts",
  jsonRoute(
    `import { getVisit, updateVisit } from "@adel/core";`,
    `
export const GET = handle(async (req, { params }) => Response.json(await getVisit(await actorFromRequest(req), params.id)));
export const PATCH = handle(async (req, { params }) => Response.json(await updateVisit(await actorFromRequest(req), params.id, await readJson(req))));
`,
  ),
);

write(
  "v1/visits/[id]/notes/route.ts",
  jsonRoute(
    `import { addVisitNote } from "@adel/core";`,
    `export const POST = handle(async (req, { params }) => Response.json(await addVisitNote(await actorFromRequest(req), params.id, await readJson(req)), { status: 201 }));`,
  ),
);

write(
  "v1/visits/[id]/photos/route.ts",
  jsonRoute(
    `import { addVisitPhoto } from "@adel/core";
import { AppError } from "@adel/core";`,
    `
export const POST = handle(async (req, { params }) => {
  const actor = await actorFromRequest(req);
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new AppError(400, "Choose a photo.", "invalid_file");
  const result = await addVisitPhoto(actor, params.id, {
    bytes: Buffer.from(await file.arrayBuffer()),
    contentType: file.type,
    caption: String(form.get("caption") ?? ""),
  });
  return Response.json(result, { status: 201 });
});
`,
  ),
);

write(
  "v1/visits/[id]/photos/[photoId]/route.ts",
  `
import { readVisitPhoto } from "@adel/core";
import { AppError } from "@adel/core";
import { actorFromRequest } from "@/lib/http";

export async function GET(req: Request, ctx: { params: Promise<{ id: string; photoId: string }> }) {
  try {
    const actor = await actorFromRequest(req);
    const { id, photoId } = await ctx.params;
    const photo = await readVisitPhoto(actor, id, photoId);
    return new Response(new Uint8Array(photo.bytes), { headers: { "content-type": photo.contentType, "cache-control": "private, max-age=3600" } });
  } catch (err) {
    if (err instanceof AppError) return Response.json({ error: err.code, message: err.message }, { status: err.status });
    console.error(err);
    return Response.json({ error: "internal_error", message: "Something went wrong." }, { status: 500 });
  }
}
`,
);

write(
  "v1/visits/[id]/signature/route.ts",
  jsonRoute(
    `import { saveSignature } from "@adel/core";`,
    `export const POST = handle(async (req, { params }) => Response.json(await saveSignature(await actorFromRequest(req), params.id, await readJson(req))));`,
  ),
);

write(
  "v1/visits/[id]/time/route.ts",
  jsonRoute(
    `import { clockVisit } from "@adel/core";`,
    `export const POST = handle(async (req, { params }) => Response.json(await clockVisit(await actorFromRequest(req), params.id, await readJson(req))));`,
  ),
);

write(
  "v1/visits/[id]/forms/route.ts",
  jsonRoute(
    `import { addVisitForm } from "@adel/core";`,
    `export const POST = handle(async (req, { params }) => Response.json(await addVisitForm(await actorFromRequest(req), params.id, await readJson(req)), { status: 201 }));`,
  ),
);

write(
  "v1/visits/[id]/forms/[formId]/route.ts",
  jsonRoute(
    `import { saveVisitForm } from "@adel/core";`,
    `export const PUT = handle(async (req, { params }) => Response.json(await saveVisitForm(await actorFromRequest(req), params.id, params.formId, await readJson(req))));`,
  ),
);

write(
  "v1/visits/[id]/complete/route.ts",
  jsonRoute(
    `import { completeVisit } from "@adel/core";`,
    `export const POST = handle(async (req, { params }) => Response.json(await completeVisit(await actorFromRequest(req), params.id)));`,
  ),
);

write(
  "v1/invoices/route.ts",
  jsonRoute(
    `import { createInvoice, listInvoices } from "@adel/core";`,
    `
export const GET = handle(async (req) => {
  const params = search(req);
  return Response.json(await listInvoices(await actorFromRequest(req), { status: params.get("status") ?? undefined, customerId: params.get("customerId") ?? undefined }));
});
export const POST = handle(async (req) => Response.json(await createInvoice(await actorFromRequest(req), await readJson(req)), { status: 201 }));
`,
  ),
);

write(
  "v1/invoices/[id]/route.ts",
  jsonRoute(
    `import { getInvoice } from "@adel/core";`,
    `export const GET = handle(async (req, { params }) => Response.json(await getInvoice(await actorFromRequest(req), params.id)));`,
  ),
);

write(
  "v1/invoices/[id]/issue/route.ts",
  jsonRoute(`import { issueInvoice } from "@adel/core";`, `export const POST = handle(async (req, { params }) => Response.json(await issueInvoice(await actorFromRequest(req), params.id)));`),
);

write(
  "v1/invoices/[id]/void/route.ts",
  jsonRoute(`import { voidInvoice } from "@adel/core";`, `export const POST = handle(async (req, { params }) => Response.json(await voidInvoice(await actorFromRequest(req), params.id)));`),
);

write(
  "v1/invoices/[id]/payments/route.ts",
  jsonRoute(
    `import { recordManualPayment } from "@adel/core";`,
    `export const POST = handle(async (req, { params }) => Response.json(await recordManualPayment(await actorFromRequest(req), params.id, await readJson(req)), { status: 201 }));`,
  ),
);

write(
  "v1/invoices/[id]/payment-intent/route.ts",
  jsonRoute(
    `import { startCardPayment } from "@adel/core";`,
    `export const POST = handle(async (req, { params }) => Response.json(await startCardPayment(await actorFromRequest(req), params.id), { status: 201 }));`,
  ),
);

write(
  "v1/invoices/[id]/payment-intent/sync/route.ts",
  jsonRoute(
    `import { syncCardPayment } from "@adel/core";`,
    `export const POST = handle(async (req, { params }) => Response.json(await syncCardPayment(await actorFromRequest(req), params.id, await readJson(req))));`,
  ),
);

write(
  "v1/tokens/route.ts",
  jsonRoute(
    `import { createApiToken, listApiTokens } from "@adel/core";`,
    `
export const GET = handle(async (req) => Response.json(await listApiTokens(await actorFromRequest(req))));
export const POST = handle(async (req) => Response.json(await createApiToken(await actorFromRequest(req), await readJson(req)), { status: 201 }));
`,
  ),
);

write(
  "v1/tokens/[id]/revoke/route.ts",
  jsonRoute(
    `import { revokeApiToken } from "@adel/core";`,
    `export const POST = handle(async (req, { params }) => Response.json(await revokeApiToken(await actorFromRequest(req), params.id)));`,
  ),
);

write(
  "v1/webhooks/route.ts",
  jsonRoute(
    `import { createWebhookEndpoint, listWebhookEndpoints } from "@adel/core";`,
    `
export const GET = handle(async (req) => Response.json(await listWebhookEndpoints(await actorFromRequest(req))));
export const POST = handle(async (req) => Response.json(await createWebhookEndpoint(await actorFromRequest(req), await readJson(req)), { status: 201 }));
`,
  ),
);

write(
  "v1/webhooks/[id]/disable/route.ts",
  jsonRoute(
    `import { disableWebhookEndpoint } from "@adel/core";`,
    `export const POST = handle(async (req, { params }) => Response.json(await disableWebhookEndpoint(await actorFromRequest(req), params.id)));`,
  ),
);

write(
  "v1/webhooks/[id]/deliveries/route.ts",
  jsonRoute(
    `import { listWebhookDeliveries } from "@adel/core";`,
    `export const GET = handle(async (req, { params }) => Response.json(await listWebhookDeliveries(await actorFromRequest(req), params.id)));`,
  ),
);

write(
  "v1/dashboard/route.ts",
  jsonRoute(`import { getDashboard } from "@adel/core";`, `export const GET = handle(async (req) => Response.json(await getDashboard(await actorFromRequest(req))));`),
);

write(
  "v1/settings/route.ts",
  jsonRoute(
    `import { getCompanySettings, updateCompanySettings } from "@adel/core";`,
    `
export const GET = handle(async (req) => {
  await actorFromRequest(req);
  return Response.json({ data: await getCompanySettings() });
});
export const PATCH = handle(async (req) => Response.json(await updateCompanySettings(await actorFromRequest(req), await readJson(req))));
`,
  ),
);

write(
  "v1/users/route.ts",
  jsonRoute(
    `import { createUser, listUsers } from "@adel/core";`,
    `
export const GET = handle(async (req) => Response.json(await listUsers(await actorFromRequest(req))));
export const POST = handle(async (req) => Response.json(await createUser(await actorFromRequest(req), await readJson(req)), { status: 201 }));
`,
  ),
);

write(
  "v1/users/[id]/route.ts",
  jsonRoute(
    `import { setUserActive } from "@adel/core";`,
    `export const PATCH = handle(async (req, { params }) => Response.json(await setUserActive(await actorFromRequest(req), params.id, await readJson(req))));`,
  ),
);

write(
  "v1/form-templates/route.ts",
  jsonRoute(
    `import { listFormTemplates } from "@adel/core";`,
    `export const GET = handle(async (req) => Response.json(await listFormTemplates(await actorFromRequest(req))));`,
  ),
);

write(
  "v1/public/quotes/[token]/route.ts",
  `
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
`,
);

write(
  "v1/public/quotes/[token]/decision/route.ts",
  `
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
`,
);

console.log("API routes written");
