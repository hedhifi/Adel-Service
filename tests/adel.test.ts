import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import yaml from "js-yaml";
import { closeDb } from "@adel/db";
import { companyToday, zonedDateTime } from "@adel/db/zoned";
import { lineAmountCents, summarizeMoney } from "@adel/db/money";
import {
  AppError,
  addVisitPhoto,
  approveQuote,
  authenticateBearer,
  clockVisit,
  completeVisit,
  convertQuote,
  createApiToken,
  createCustomer,
  createInvoice,
  createProperty,
  createQuote,
  createRequest,
  createWebhookEndpoint,
  decidePublicQuote,
  getInvoice,
  getJob,
  getPublicQuote,
  getVisit,
  issueInvoice,
  listCustomers,
  loginWithPassword,
  recordManualPayment,
  revokeApiToken,
  saveSignature,
  scheduleVisit,
  sendQuote,
  signWebhook,
  stripeSecretKey,
} from "@adel/core";
import { GET as listCustomersRoute } from "../apps/web/src/app/api/v1/customers/route";
import { POST as loginRoute } from "../apps/web/src/app/api/auth/login/route";
import { TOOL_NAMES } from "../packages/mcp/src/tools";
import { PASSWORD, seedCompany } from "./helpers";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

afterAll(async () => {
  await closeDb();
});

describe("money", () => {
  it("rounds line amounts half up and taxes taxable materials only", () => {
    expect(lineAmountCents("1.50", 100)).toBe(150);
    expect(lineAmountCents("2", 16500)).toBe(33000);
    const summary = summarizeMoney(
      [
        { quantity: "2", unitAmountCents: 16500, taxable: false },
        { quantity: "1", unitAmountCents: 8500, taxable: true },
      ],
      700,
    );
    expect(summary.taxCents).toBe(595);
    expect(summary.totalCents).toBe(42095);
  });
});

describe("auth and roles", () => {
  it("rejects a bad password and blocks technicians from the customer list", async () => {
    const { tech } = await seedCompany();
    await expect(loginWithPassword({ email: "alan@adel.example", password: "wrong-password" })).rejects.toMatchObject({
      status: 401,
      code: "invalid_credentials",
    });
    await expect(listCustomers(tech)).rejects.toBeInstanceOf(AppError);
    await expect(listCustomers(tech)).rejects.toMatchObject({ status: 403 });
  });

  it("signs in through the login route and accepts a scoped bearer token", async () => {
    const { admin, office, tech } = await seedCompany();
    const denied = await loginRoute(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: admin.email, password: "nope" }),
      }),
    );
    expect(denied.status).toBe(401);

    const signedIn = await loginRoute(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: admin.email, password: PASSWORD }),
      }),
    );
    expect(signedIn.status).toBe(200);
    const cookie = signedIn.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("adel_session=");

    const created = await createApiToken(admin, { name: "Office desk", role: "office" });
    const bearer = await listCustomersRoute(
      new Request("http://localhost/api/v1/customers", {
        headers: { authorization: `Bearer ${created.secret}` },
      }),
    );
    expect(bearer.status).toBe(200);

    await expect(createApiToken(office, { name: "Should fail", role: "office" })).rejects.toMatchObject({ status: 403 });
    await expect(createApiToken(admin, { name: "Field", role: "tech" })).rejects.toMatchObject({ status: 400 });
    const field = await createApiToken(admin, { name: "Marco", role: "tech", userId: tech.id });
    const actor = await authenticateBearer(`Bearer ${field.secret}`);
    expect(actor.role).toBe("tech");
    expect(actor.id).toBe(tech.id);
    await revokeApiToken(admin, field.data.id);
    await expect(authenticateBearer(`Bearer ${field.secret}`)).rejects.toMatchObject({ status: 401 });
  });

  it("refuses live Stripe keys", () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_not_allowed";
    expect(() => stripeSecretKey()).toThrow(/test-mode/);
    process.env.STRIPE_SECRET_KEY = "sk_test_replace_me";
    expect(stripeSecretKey()).toBeNull();
  });
});

describe("request to payment", () => {
  it("runs request, quote, job, visit, invoice, and signed webhooks", async () => {
    const seen: Array<{ event: string; body: string; signature: string; timestamp: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        seen.push({
          event: headers.get("X-Adel-Event") ?? "",
          body: String(init?.body ?? ""),
          signature: headers.get("X-Adel-Signature") ?? "",
          timestamp: headers.get("X-Adel-Timestamp") ?? "",
        });
        return new Response("ok", { status: 200 });
      }),
    );

    try {
      const { adel, office, tech, otherTech } = await seedCompany();
      const hook = await createWebhookEndpoint(office, {
        url: "https://hooks.example.test/adel",
        events: [
          "request.created",
          "quote.approved",
          "job.scheduled",
          "visit.completed",
          "invoice.issued",
          "payment.received",
        ],
      });

      const customer = await createCustomer(office, {
        brandId: adel.id,
        name: "Camille Calder",
        email: "camille.calder@example.test",
        phone: "239-555-0199",
      });
      const property = await createProperty(office, customer.data.id, {
        label: "House",
        line1: "88 Gulf Shore Blvd N",
        city: "Naples",
        postalCode: "34102",
      });
      expect(property.data.state).toBe("FL");

      const request = await createRequest(office, {
        customerId: customer.data.id,
        propertyId: property.data.id,
        brandId: adel.id,
        title: "Panel buzzing in the garage",
        description: "Heard a buzz after the last storm. Please look at the main panel.",
        source: "phone",
      });
      expect(request.data.status).toBe("new");

      const quote = await createQuote(office, {
        customerId: customer.data.id,
        propertyId: property.data.id,
        brandId: adel.id,
        requestId: request.data.id,
        title: "Panel inspection and breaker",
        lineItems: [
          { kind: "labor", description: "Diagnostic and breaker swap", quantity: "2", unitAmountCents: 16500, taxable: false },
          { kind: "material", description: "20A breaker", quantity: "1", unitAmountCents: 8500, taxable: true },
        ],
      });
      expect(quote.data.totalCents).toBe(42095);
      expect(quote.data.status).toBe("draft");

      const sent = await sendQuote(office, quote.data.id);
      expect(sent.data.publicPath).toMatch(/^\/q\//);
      const token = sent.data.publicToken as string;
      const publicView = await getPublicQuote(token);
      expect(publicView.data.company).toBe("Adel Electric, LLC");

      const approved = await approveQuote(office, quote.data.id, { approvedByName: "Camille Calder" });
      expect(approved.data.status).toBe("approved");

      const job = await convertQuote(office, quote.data.id);
      expect(job.data.status).toBe("unscheduled");

      const day = companyToday("America/New_York");
      const start = zonedDateTime(day, "10:00", "America/New_York");
      const end = zonedDateTime(day, "12:00", "America/New_York");
      const visit = await scheduleVisit(office, {
        jobId: job.data.id,
        technicianId: tech.id,
        scheduledStart: start.toISOString(),
        scheduledEnd: end.toISOString(),
      });
      expect(visit.data.status).toBe("scheduled");
      await expect(getVisit(otherTech, visit.data.id)).rejects.toMatchObject({ status: 403 });

      await clockVisit(tech, visit.data.id, { action: "in", note: "On site" });
      await addVisitPhoto(tech, visit.data.id, { bytes: PNG, contentType: "image/png", caption: "Panel cover" });
      await expect(completeVisit(tech, visit.data.id)).rejects.toMatchObject({ code: "signature_required" });
      await saveSignature(tech, visit.data.id, {
        signedByName: "Camille Calder",
        signaturePng: `data:image/png;base64,${PNG.toString("base64")}`,
      });
      const done = await completeVisit(tech, visit.data.id);
      expect(done.data.status).toBe("completed");
      const finishedJob = await getJob(office, job.data.id);
      expect(finishedJob.data.status).toBe("completed");

      const draft = await createInvoice(office, { jobId: job.data.id });
      expect(draft.data.totalCents).toBe(42095);
      expect(draft.data.status).toBe("draft");
      const issued = await issueInvoice(office, draft.data.id);
      expect(issued.data.status).toBe("issued");
      await recordManualPayment(office, draft.data.id, { method: "check", amountCents: 42095, reference: "1044" });
      const paid = await getInvoice(office, draft.data.id);
      expect(paid.data.status).toBe("paid");
      expect(paid.data.balanceCents).toBe(0);
      await expect(getInvoice(otherTech, draft.data.id)).rejects.toMatchObject({ status: 403 });
      const techView = await getInvoice(tech, draft.data.id);
      expect(techView.data.balanceCents).toBe(0);

      const events = seen.map((row) => row.event);
      expect(events).toEqual([
        "request.created",
        "quote.approved",
        "job.scheduled",
        "visit.completed",
        "invoice.issued",
        "payment.received",
      ]);
      for (const row of seen) {
        const expected = `sha256=${signWebhook(hook.secret, Number(row.timestamp), row.body)}`;
        expect(row.signature).toBe(expected);
        expect(JSON.parse(row.body).type).toBe(row.event);
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("lets a customer approve a sent estimate from the public link", async () => {
    const { adel, office } = await seedCompany();
    const customer = await createCustomer(office, { brandId: adel.id, name: "Helen Cho" });
    const property = await createProperty(office, customer.data.id, {
      label: "Kitchen",
      line1: "14 Osprey Avenue",
      city: "Sarasota",
      postalCode: "34236",
    });
    const quote = await createQuote(office, {
      customerId: customer.data.id,
      propertyId: property.data.id,
      brandId: adel.id,
      title: "Under-cabinet lighting",
      lineItems: [{ kind: "labor", description: "Install drivers", quantity: "1", unitAmountCents: 24000, taxable: false }],
    });
    const sent = await sendQuote(office, quote.data.id);
    const decided = await decidePublicQuote(sent.data.publicToken as string, {
      decision: "approve",
      name: "Helen Cho",
    });
    expect(decided.data.status).toBe("approved");
  });
});

describe("contract", () => {
  it("matches the OpenAPI document to the route handlers", () => {
    const spec = yaml.load(readFileSync(path.join(root, "openapi/openapi.yaml"), "utf8")) as {
      paths: Record<string, Record<string, unknown>>;
    };
    const json = JSON.parse(readFileSync(path.join(root, "openapi/openapi.json"), "utf8")) as {
      paths: Record<string, Record<string, unknown>>;
    };
    expect(Object.keys(json.paths).sort()).toEqual(Object.keys(spec.paths).sort());

    const methods = new Map<string, string[]>();
    function walk(dir: string) {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry === "route.ts") {
          const rel = path.relative(path.join(root, "apps/web/src/app"), path.dirname(full));
          const urlPath = `/${rel.split(path.sep).join("/").replace(/\[(.+?)\]/g, "{$1}")}`;
          const source = readFileSync(full, "utf8");
          const found = [...source.matchAll(/export (?:const |async function |function )(GET|POST|PATCH|PUT|DELETE)/g)].map(
            (match) => match[1].toLowerCase(),
          );
          methods.set(urlPath, found.sort());
        }
      }
    }
    walk(path.join(root, "apps/web/src/app/api"));
    const specMethods = new Map(
      Object.entries(spec.paths).map(([urlPath, operations]) => [
        urlPath,
        Object.keys(operations)
          .filter((key) => ["get", "post", "patch", "put", "delete"].includes(key))
          .sort(),
      ]),
    );
    expect([...methods.keys()].sort()).toEqual([...specMethods.keys()].sort());
    for (const [urlPath, verbs] of methods) {
      expect(specMethods.get(urlPath), urlPath).toEqual(verbs);
    }
  });

  it("exposes the MCP tools an assistant needs", () => {
    expect(TOOL_NAMES).toEqual(
      expect.arrayContaining([
        "list_customers",
        "create_request",
        "create_quote",
        "approve_quote",
        "schedule_visit",
        "complete_visit",
        "issue_invoice",
        "record_payment",
      ]),
    );
    expect(new Set(TOOL_NAMES).size).toBe(TOOL_NAMES.length);
  });
});
