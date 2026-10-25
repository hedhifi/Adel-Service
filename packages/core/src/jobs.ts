import { createHash, timingSafeEqual } from "node:crypto";
import { AppError } from "./errors";
import { log } from "./log";
import { processReportReminders, purgeOldLocationPoints } from "./location";
import { deliverPending } from "./webhooks";

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

export function cronAuthorized(authorization: string | null): "ok" | "denied" | "unconfigured" {
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  if (secret.length < 16 || secret.toLowerCase().includes("replace")) return "unconfigured";
  const match = /^Bearer\s+(\S+)$/i.exec(authorization?.trim() ?? "");
  const presented = match?.[1] ?? "";
  const same = timingSafeEqual(digest(presented), digest(secret));
  return same ? "ok" : "denied";
}

export function assertCronAuthorized(authorization: string | null) {
  const result = cronAuthorized(authorization);
  if (result === "unconfigured") {
    throw new AppError(503, "Set CRON_SECRET to a random string of at least 16 characters.", "cron_not_configured");
  }
  if (result === "denied") throw new AppError(401, "Cron secret rejected.", "unauthenticated");
}

export async function runScheduledJobs() {
  const started = Date.now();
  const purgedLocations = await purgeOldLocationPoints();
  const reminders = await processReportReminders();
  const webhooks = await deliverPending(50, { retryFailed: true });
  log("info", "scheduled jobs finished", {
    purgedLocations,
    reminders: reminders.length,
    webhooks,
    ms: Date.now() - started,
  });
  return { purgedLocations, reminders: reminders.length, webhooks };
}
