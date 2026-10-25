import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, webhookDeliveries } from "@adel/db";
import {
  assertRuntimeConfig,
  createWebhookEndpoint,
  deliverPending,
  normalizeStorageKey,
  objectStore,
  storageHealth,
} from "@adel/core";
import { describe, expect, it, vi } from "vitest";
import { enqueueFix, readLocationQueue, takeFixes } from "../apps/web/src/lib/location-queue";
import { GET as health } from "../apps/web/src/app/api/health/route";
import { GET as live } from "../apps/web/src/app/api/health/live/route";
import { POST as cron } from "../apps/web/src/app/api/cron/run/route";
import { seedCompany } from "./helpers";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function read(relative: string) {
  return readFile(path.join(root, relative), "utf8");
}

describe("hosting", () => {
  it("stores a photo on local disk and rejects a path escape", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "adel-uploads-"));
    const previousDir = process.env.UPLOAD_DIR;
    const previousDriver = process.env.STORAGE_DRIVER;
    process.env.UPLOAD_DIR = dir;
    process.env.STORAGE_DRIVER = "local";
    try {
      const store = objectStore();
      await store.put("visit/photo.jpg", Buffer.from("abc"), "image/jpeg");
      expect((await store.get("visit/photo.jpg")).toString()).toBe("abc");
      expect(await readFile(path.join(dir, "visit", "photo.jpg"), "utf8")).toBe("abc");
      expect(() => normalizeStorageKey("../secret")).toThrow(/Invalid storage key/);
      const health = await storageHealth();
      expect(health).toEqual({ ok: true, detail: "local" });
    } finally {
      if (previousDir === undefined) delete process.env.UPLOAD_DIR;
      else process.env.UPLOAD_DIR = previousDir;
      if (previousDriver === undefined) delete process.env.STORAGE_DRIVER;
      else process.env.STORAGE_DRIVER = previousDriver;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses an incomplete S3 configuration without calling the network", async () => {
    const previous = {
      driver: process.env.STORAGE_DRIVER,
      bucket: process.env.S3_BUCKET,
      key: process.env.S3_ACCESS_KEY_ID,
      secret: process.env.S3_SECRET_ACCESS_KEY,
    };
    process.env.STORAGE_DRIVER = "s3";
    delete process.env.S3_BUCKET;
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;
    try {
      const health = await storageHealth();
      expect(health.ok).toBe(false);
      await expect(objectStore().put("visit/photo.jpg", Buffer.from("a"), "image/jpeg")).rejects.toMatchObject({
        status: 503,
        code: "storage_not_configured",
      });
    } finally {
      for (const [name, value] of [
        ["STORAGE_DRIVER", previous.driver],
        ["S3_BUCKET", previous.bucket],
        ["S3_ACCESS_KEY_ID", previous.key],
        ["S3_SECRET_ACCESS_KEY", previous.secret],
      ] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it("requires https and test-mode Stripe when the production server boots", () => {
    const previous = {
      node: process.env.NODE_ENV,
      server: process.env.ADEL_SERVER,
      app: process.env.APP_URL,
      secret: process.env.SESSION_SECRET,
      stripe: process.env.STRIPE_SECRET_KEY,
      publishable: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    };
    process.env.ADEL_SERVER = "1";
    process.env.NODE_ENV = "production";
    process.env.SESSION_SECRET = "production-session-secret-value";
    process.env.STRIPE_SECRET_KEY = "sk_test_examplekey";
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_examplekey";
    process.env.APP_URL = "http://service.example.com";
    try {
      expect(() => assertRuntimeConfig()).toThrow(/https/);
      process.env.APP_URL = "https://service.example.com";
      expect(() => assertRuntimeConfig()).not.toThrow();
      process.env.STRIPE_SECRET_KEY = "sk_live_not_allowed";
      expect(() => assertRuntimeConfig()).toThrow(/test-mode/);
    } finally {
      process.env.NODE_ENV = previous.node;
      process.env.SESSION_SECRET = previous.secret;
      const restore = (name: string, value: string | undefined) => {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      };
      restore("ADEL_SERVER", previous.server);
      restore("APP_URL", previous.app);
      restore("STRIPE_SECRET_KEY", previous.stripe);
      restore("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", previous.publishable);
    }
  });

  it("answers health checks and runs cron only with the configured secret", async () => {
    await seedCompany();
    const ready = await health();
    expect(ready.status).toBe(200);
    const body = (await ready.json()) as { ok: boolean; db: string; stripe: string };
    expect(body.ok).toBe(true);
    expect(body.db).toBe("up");
    expect(body.stripe).not.toBe("live");
    expect((await live()).status).toBe(200);

    const previous = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    try {
      expect((await cron(new Request("http://localhost/api/cron/run", { method: "POST" }))).status).toBe(503);
      process.env.CRON_SECRET = "cron-secret-for-tests";
      expect(
        (
          await cron(
            new Request("http://localhost/api/cron/run", {
              method: "POST",
              headers: { authorization: "Bearer wrong-secret-value" },
            }),
          )
        ).status,
      ).toBe(401);
      const ran = await cron(
        new Request("http://localhost/api/cron/run", {
          method: "POST",
          headers: { authorization: "Bearer cron-secret-for-tests" },
        }),
      );
      expect(ran.status).toBe(200);
      expect(await ran.json()).toMatchObject({ ok: true, webhooks: 0 });
    } finally {
      if (previous === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = previous;
    }
  });

  it("retries a failed webhook after the backoff and stops after five attempts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("ok", { status: 200 })),
    );
    try {
      const { office } = await seedCompany();
      const hook = await createWebhookEndpoint(office, {
        url: "https://hooks.example.test/adel",
        events: ["payment.received"],
      });
      const old = new Date(Date.now() - 30 * 60 * 1000);
      await db.insert(webhookDeliveries).values([
        {
          endpointId: hook.data.id,
          event: "payment.received",
          payload: { id: "retry-me", type: "payment.received" },
          status: "failed",
          attemptCount: 1,
          createdAt: old,
        },
        {
          endpointId: hook.data.id,
          event: "payment.received",
          payload: { id: "give-up", type: "payment.received" },
          status: "failed",
          attemptCount: 5,
          createdAt: old,
        },
      ]);
      const count = await deliverPending(10, { retryFailed: true });
      expect(count).toBe(1);
      expect(vi.mocked(fetch).mock.calls.length).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("queues location points and documents the deploy files without secrets", async () => {
    expect(enqueueFix([{ recordedAt: "a", latitude: 1, longitude: 2, accuracyMeters: 0, batteryPercent: 10 }], {
      recordedAt: "b",
      latitude: 3,
      longitude: 4,
      accuracyMeters: 5,
      batteryPercent: 6,
    }, 1)).toEqual([{ recordedAt: "b", latitude: 3, longitude: 4, accuracyMeters: 5, batteryPercent: 6 }]);
    expect(takeFixes([{ recordedAt: "a", latitude: 1, longitude: 2, accuracyMeters: 0, batteryPercent: 1 }], 1).rest).toEqual([]);
    expect(readLocationQueue("not json")).toEqual([]);

    const example = await read(".env.example");
    expect(example).toContain("STORAGE_DRIVER=local");
    expect(example).toContain("CRON_SECRET");
    expect(example).toMatch(/sk_live_/);
    expect(example).not.toMatch(/=\s*sk_live_|=\s*pk_live_|=\s*rk_live_/);
    for (const file of ["render.yaml", "fly.toml", "docker-compose.prod.yml", "Dockerfile"]) {
      expect(await read(file)).not.toMatch(/sk_live_|pk_live_|rk_live_|BEGIN [A-Z ]+PRIVATE KEY/);
    }

    const dockerfile = await read("Dockerfile");
    expect(dockerfile).toContain("docker-entrypoint.sh");
    expect(dockerfile).toContain("ADEL_SERVER=1");
    const entry = await read("scripts/docker-entrypoint.sh");
    expect(entry).toContain("migrate.mjs");
    const worker = await read("apps/web/public/sw.js");
    expect(worker).toContain('request.method !== "GET"');
    expect(worker).toContain('url.pathname.startsWith("/api/")');
    expect(worker).toContain("/offline.html");
    const guide = await read("docs/DEPLOYMENT.md");
    expect(guide).toContain("test mode");
    expect(guide).toMatch(/Render/);
    expect(guide).toMatch(/Fly\.io/);
  });
});
