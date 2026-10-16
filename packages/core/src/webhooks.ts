import { createHmac, randomUUID } from "node:crypto";
import { db, webhookDeliveries, webhookEndpoints } from "@adel/db";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "./db";
import { AppError } from "./errors";
import { parse } from "./parse";
import { assertOffice, type Actor } from "./permissions";

export const WEBHOOK_EVENTS = [
  "request.created",
  "quote.approved",
  "job.scheduled",
  "visit.completed",
  "invoice.issued",
  "payment.received",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

const eventSchema = z.enum(WEBHOOK_EVENTS);

export function signWebhook(secret: string, timestamp: number, body: string) {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export async function emitEvent(tx: Tx, event: WebhookEvent, data: Record<string, unknown>) {
  const hooks = await tx.select().from(webhookEndpoints).where(eq(webhookEndpoints.active, true));
  const payload = {
    id: randomUUID(),
    type: event,
    createdAt: new Date().toISOString(),
    data,
  };
  for (const hook of hooks) {
    if (!hook.events.includes(event)) continue;
    await tx.insert(webhookDeliveries).values({
      endpointId: hook.id,
      event,
      payload,
      status: "pending",
    });
  }
}

export async function deliverPending(limit = 25) {
  const pending = await db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.status, "pending"))
    .limit(limit);

  for (const delivery of pending) {
    const [endpoint] = await db
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.id, delivery.endpointId));
    if (!endpoint || !endpoint.active) {
      await db
        .update(webhookDeliveries)
        .set({ status: "failed", responseBody: "Endpoint inactive", attemptCount: delivery.attemptCount + 1 })
        .where(eq(webhookDeliveries.id, delivery.id));
      continue;
    }

    const body = JSON.stringify(delivery.payload);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signWebhook(endpoint.secret, timestamp, body);
    try {
      const response = await fetch(endpoint.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "AdelService-Webhooks/0.1",
          "X-Adel-Event": delivery.event,
          "X-Adel-Delivery": delivery.id,
          "X-Adel-Timestamp": String(timestamp),
          "X-Adel-Signature": `sha256=${signature}`,
        },
        body,
        signal: AbortSignal.timeout(5000),
      });
      const text = await response.text();
      await db
        .update(webhookDeliveries)
        .set({
          status: response.ok ? "delivered" : "failed",
          responseCode: response.status,
          responseBody: text.slice(0, 500),
          attemptCount: delivery.attemptCount + 1,
          deliveredAt: response.ok ? new Date() : null,
        })
        .where(eq(webhookDeliveries.id, delivery.id));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Delivery failed";
      await db
        .update(webhookDeliveries)
        .set({
          status: "failed",
          responseBody: message.slice(0, 500),
          attemptCount: delivery.attemptCount + 1,
        })
        .where(eq(webhookDeliveries.id, delivery.id));
    }
  }
}

export async function safeDeliver() {
  try {
    await deliverPending();
  } catch (err) {
    console.error("webhook delivery failed", err);
  }
}

function publicEndpoint(row: typeof webhookEndpoints.$inferSelect) {
  return {
    id: row.id,
    url: row.url,
    description: row.description,
    events: row.events,
    active: row.active,
    createdAt: row.createdAt,
  };
}

export async function listWebhookEndpoints(actor: Actor) {
  assertOffice(actor);
  const rows = await db.select().from(webhookEndpoints).orderBy(desc(webhookEndpoints.createdAt));
  return { data: rows.map(publicEndpoint) };
}

export async function createWebhookEndpoint(actor: Actor, input: unknown) {
  assertOffice(actor);
  const data = parse(
    z.object({
      url: z.string().url(),
      description: z.string().trim().max(200).optional(),
      events: z.array(eventSchema).min(1),
    }),
    input,
  );
  const secret = `whsec_${randomUUID().replace(/-/g, "")}`;
  const [row] = await db
    .insert(webhookEndpoints)
    .values({
      url: data.url,
      description: data.description ?? null,
      events: data.events,
      secret,
    })
    .returning();
  return { data: publicEndpoint(row), secret };
}

export async function disableWebhookEndpoint(actor: Actor, id: string) {
  assertOffice(actor);
  const [row] = await db
    .update(webhookEndpoints)
    .set({ active: false })
    .where(eq(webhookEndpoints.id, id))
    .returning();
  if (!row) throw new AppError(404, "Webhook endpoint not found.", "not_found");
  return { data: publicEndpoint(row) };
}

export async function listWebhookDeliveries(actor: Actor, endpointId: string) {
  assertOffice(actor);
  const [endpoint] = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, endpointId));
  if (!endpoint) throw new AppError(404, "Webhook endpoint not found.", "not_found");
  const rows = await db
    .select({
      id: webhookDeliveries.id,
      event: webhookDeliveries.event,
      status: webhookDeliveries.status,
      responseCode: webhookDeliveries.responseCode,
      attemptCount: webhookDeliveries.attemptCount,
      createdAt: webhookDeliveries.createdAt,
      deliveredAt: webhookDeliveries.deliveredAt,
    })
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.endpointId, endpointId))
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(50);
  return { data: rows };
}
