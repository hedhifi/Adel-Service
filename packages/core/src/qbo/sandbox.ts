import { createHmac } from "node:crypto";
import { db, qboSandboxObjects } from "@adel/db";
import { pepper } from "@adel/db/secrets";
import { and, eq } from "drizzle-orm";
import { AppError } from "../errors";

export const INTUIT_SANDBOX_BASE = "https://sandbox-quickbooks.api.intuit.com";
export const INTUIT_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
export const INTUIT_AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";

export type QboType = "Customer" | "Item" | "Invoice" | "Payment" | "Vendor" | "Bill" | "BillPayment";

export type QboObject = {
  Id: string;
  SyncToken: string;
} & Record<string, unknown>;

export class QboStaleError extends Error {
  constructor() {
    super("QuickBooks has a newer version of this record.");
    this.name = "QboStaleError";
  }
}

export class QboSandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QboSandboxError";
  }
}

const LIVE_MARKERS = [/sk_live_/i, /pk_live_/i, /rk_live_/i, /production/i, /quickbooks\.api\.intuit\.com(?!\/)/i];

export function assertNotProductionEnv() {
  const environment = (process.env.QBO_ENVIRONMENT ?? "sandbox").toLowerCase();
  if (environment !== "sandbox") {
    throw new AppError(
      400,
      "QuickBooks production is not enabled. Leave QBO_ENVIRONMENT unset or set it to sandbox.",
      "qbo_production_refused",
    );
  }
  if (process.env.QBO_API_BASE) assertSandboxBase(process.env.QBO_API_BASE);
}

export function assertSandboxBase(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AppError(400, "QuickBooks host is not the Intuit sandbox.", "qbo_production_refused");
  }
  if (parsed.origin !== INTUIT_SANDBOX_BASE) {
    throw new AppError(
      400,
      "QuickBooks calls stay on the Intuit sandbox. The production host is refused.",
      "qbo_production_refused",
    );
  }
}

function looksLive(value: string) {
  return LIVE_MARKERS.some((pattern) => pattern.test(value));
}

/** True when Development (sandbox) app keys are present. Live-looking keys throw. */
export function intuitSandboxConfigured() {
  assertNotProductionEnv();
  const clientId = process.env.QBO_CLIENT_ID ?? "";
  const secret = process.env.QBO_CLIENT_SECRET ?? "";
  if (!clientId || !secret || clientId.includes("replace") || secret.includes("replace")) return false;
  if (looksLive(clientId) || looksLive(secret)) {
    throw new AppError(400, "QuickBooks live credentials are refused. Use an Intuit sandbox app.", "qbo_live_refused");
  }
  return true;
}

export function signOAuthState(entityId: string) {
  const sig = createHmac("sha256", pepper()).update(`qbo:${entityId}`).digest("hex");
  return `${entityId}.${sig}`;
}

export function readOAuthState(state: string) {
  const [entityId, sig] = state.split(".");
  if (!entityId || !sig || signOAuthState(entityId) !== state) return null;
  return entityId;
}

export function sandboxAuthorizeUrl(entityId: string) {
  if (!intuitSandboxConfigured()) {
    throw new AppError(400, "Intuit sandbox keys are not configured.", "qbo_not_configured");
  }
  const redirect = process.env.QBO_REDIRECT_URI ?? "";
  if (!redirect) throw new AppError(400, "Set QBO_REDIRECT_URI to this app's sandbox callback.", "qbo_not_configured");
  const url = new URL(INTUIT_AUTHORIZE_URL);
  url.searchParams.set("client_id", process.env.QBO_CLIENT_ID ?? "");
  url.searchParams.set("redirect_uri", redirect);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "com.intuit.quickbooks.accounting");
  url.searchParams.set("state", signOAuthState(entityId));
  return url.toString();
}

export function stripQbo(obj: Record<string, unknown>) {
  const rest = { ...obj };
  delete rest.Id;
  delete rest.SyncToken;
  return rest;
}

let remainingFaults = 0;

export function failNextSandboxWrites(count: number) {
  if (process.env.NODE_ENV === "production") return;
  remainingFaults = count;
}

export function resetSandboxFaults() {
  remainingFaults = 0;
}

function consumeFault() {
  if (remainingFaults <= 0) return;
  remainingFaults -= 1;
  throw new QboSandboxError("The QuickBooks sandbox did not accept the write.");
}

export interface QboProvider {
  readonly name: "mock" | "intuit";
  upsert(realmId: string, type: QboType, body: Record<string, unknown>, existing?: { Id: string; SyncToken: string }): Promise<QboObject>;
  get(realmId: string, type: QboType, id: string): Promise<QboObject | null>;
  list(realmId: string, type: QboType): Promise<QboObject[]>;
}

function asObject(payload: unknown): QboObject {
  const row = payload as QboObject;
  return { ...row, Id: String(row.Id), SyncToken: String(row.SyncToken) };
}

export class MockSandboxProvider implements QboProvider {
  readonly name = "mock" as const;

  async upsert(realmId: string, type: QboType, body: Record<string, unknown>, existing?: { Id: string; SyncToken: string }) {
    consumeFault();
    const clean = stripQbo(body);
    if (!existing) {
      const rows = await db
        .select({ qboId: qboSandboxObjects.qboId })
        .from(qboSandboxObjects)
        .where(and(eq(qboSandboxObjects.realmId, realmId), eq(qboSandboxObjects.qboType, type)));
      const next = rows.reduce((max, row) => Math.max(max, Number(row.qboId) || 0), 0) + 1;
      const qboId = String(next);
      const payload = { ...clean, Id: qboId, SyncToken: "0" };
      await db.insert(qboSandboxObjects).values({ realmId, qboType: type, qboId, syncToken: 0, payload });
      return asObject(payload);
    }
    const [row] = await db
      .select()
      .from(qboSandboxObjects)
      .where(
        and(eq(qboSandboxObjects.realmId, realmId), eq(qboSandboxObjects.qboType, type), eq(qboSandboxObjects.qboId, existing.Id)),
      );
    if (!row) throw new QboSandboxError("That QuickBooks record is not in this sandbox company.");
    if (String(row.syncToken) !== existing.SyncToken) throw new QboStaleError();
    const syncToken = row.syncToken + 1;
    const payload = { ...clean, Id: row.qboId, SyncToken: String(syncToken) };
    await db
      .update(qboSandboxObjects)
      .set({ syncToken, payload, updatedAt: new Date() })
      .where(
        and(eq(qboSandboxObjects.realmId, realmId), eq(qboSandboxObjects.qboType, type), eq(qboSandboxObjects.qboId, existing.Id)),
      );
    return asObject(payload);
  }

  async get(realmId: string, type: QboType, id: string) {
    const [row] = await db
      .select()
      .from(qboSandboxObjects)
      .where(and(eq(qboSandboxObjects.realmId, realmId), eq(qboSandboxObjects.qboType, type), eq(qboSandboxObjects.qboId, id)));
    return row ? asObject(row.payload) : null;
  }

  async list(realmId: string, type: QboType) {
    const rows = await db
      .select()
      .from(qboSandboxObjects)
      .where(and(eq(qboSandboxObjects.realmId, realmId), eq(qboSandboxObjects.qboType, type)));
    return rows.map((row) => asObject(row.payload));
  }
}

function entityPath(type: QboType) {
  return type === "BillPayment" ? "billpayment" : type.toLowerCase();
}

export class IntuitSandboxProvider implements QboProvider {
  readonly name = "intuit" as const;

  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
    baseUrl = process.env.QBO_API_BASE ?? INTUIT_SANDBOX_BASE,
  ) {
    assertSandboxBase(baseUrl);
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  private readonly baseUrl: string;

  private async call(realmId: string, path: string, init?: RequestInit) {
    const response = await this.fetchImpl(`${this.baseUrl}/v3/company/${realmId}/${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    const text = await response.text();
    if (!response.ok) throw new QboSandboxError(`QuickBooks sandbox returned ${response.status}.`);
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  }

  async upsert(realmId: string, type: QboType, body: Record<string, unknown>, existing?: { Id: string; SyncToken: string }) {
    const payload = existing ? { ...stripQbo(body), Id: existing.Id, SyncToken: existing.SyncToken, sparse: true } : stripQbo(body);
    const json = await this.call(realmId, `${entityPath(type)}?minorversion=75`, { method: "POST", body: JSON.stringify(payload) });
    const entity = json[type];
    if (!entity || typeof entity !== "object") throw new QboSandboxError("QuickBooks sandbox returned an empty record.");
    return asObject(entity as QboObject);
  }

  async get(realmId: string, type: QboType, id: string) {
    try {
      const json = await this.call(realmId, `${entityPath(type)}/${id}?minorversion=75`, { method: "GET" });
      const entity = json[type];
      if (!entity || typeof entity !== "object") return null;
      return asObject(entity as QboObject);
    } catch (err) {
      if (err instanceof QboSandboxError && err.message.includes("404")) return null;
      throw err;
    }
  }

  async list(realmId: string, type: QboType) {
    const query = `select * from ${type} maxresults 1000`;
    const json = await this.call(realmId, `query?query=${encodeURIComponent(query)}&minorversion=75`, { method: "GET" });
    const response = json.QueryResponse as Record<string, unknown> | undefined;
    const rows = response?.[type];
    if (!Array.isArray(rows)) return [];
    return rows.map((row) => asObject(row as QboObject));
  }
}

export async function exchangeSandboxCode(code: string) {
  if (!intuitSandboxConfigured()) {
    throw new AppError(400, "Intuit sandbox keys are not configured.", "qbo_not_configured");
  }
  const redirect = process.env.QBO_REDIRECT_URI ?? "";
  const basic = Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString("base64");
  const response = await fetch(INTUIT_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirect }),
  });
  if (!response.ok) throw new QboSandboxError("The Intuit sandbox did not exchange that code.");
  const json = (await response.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!json.access_token || !json.refresh_token) throw new QboSandboxError("The Intuit sandbox returned no token.");
  if (looksLive(json.access_token)) {
    throw new AppError(400, "QuickBooks live credentials are refused.", "qbo_live_refused");
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: new Date(Date.now() + (json.expires_in ?? 3600) * 1000),
  };
}
