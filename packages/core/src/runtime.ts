import { stripePublishableKey, stripeSecretKey } from "./billing";
import { log } from "./log";
import { storageConfig } from "./storage";

export function stripeMode(): "test" | "unconfigured" {
  stripeSecretKey();
  stripePublishableKey();
  const secret = process.env.STRIPE_SECRET_KEY ?? "";
  if (secret.startsWith("sk_test_") && !secret.includes("replace")) return "test";
  return "unconfigured";
}

export function assertStripeTestMode() {
  stripeSecretKey();
  stripePublishableKey();
}

function placeholder(value: string | undefined) {
  const text = value?.trim() ?? "";
  return text.length === 0 || text.toLowerCase().includes("replace");
}

export function assertRuntimeConfig() {
  assertStripeTestMode();
  if (process.env.ADEL_SERVER !== "1" || process.env.NODE_ENV !== "production") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const secret = process.env.SESSION_SECRET ?? "";
  if (placeholder(secret) || secret.length < 16) {
    throw new Error("SESSION_SECRET must be a random string of at least 16 characters in production.");
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required in production.");
  }
  let appUrl: URL;
  try {
    appUrl = new URL(process.env.APP_URL ?? "");
  } catch {
    throw new Error("APP_URL must be the public https:// address of this install.");
  }
  if (appUrl.protocol !== "https:") {
    throw new Error("APP_URL must start with https:// in production.");
  }
  const storage = storageConfig();
  if ("error" in storage) throw new Error(storage.error);
  log("info", "production configuration accepted", {
    storage: storage.driver,
    stripe: stripeMode(),
    host: appUrl.host,
  });
}
