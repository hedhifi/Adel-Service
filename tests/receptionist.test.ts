import {
  ADEL_ENTITY_ID,
  SERVICE_BRAND_ID,
  SERVICE_ENTITY_ID,
  customers,
  db,
  requests,
  sql,
  visits,
  webhookDeliveries,
  receptionistSandboxMessages,
} from "@adel/db";
import {
  AppError,
  authenticateBearer,
  createApiToken,
  createCustomer,
  createJob,
  createProperty,
  createWebhookEndpoint,
  exportEntity,
  getReceptionistConversation,
  listCustomers,
  listOpenSlots,
  listReceptionistConversations,
  listRequests,
  messagingProvider,
  postReceptionistMessage,
  scheduleVisit,
  startReceptionistConversation,
  updateReceptionistSettings,
} from "@adel/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as startRoute } from "../apps/web/src/app/api/v1/public/receptionist/conversations/route";
import { asActor, seedCompany } from "./helpers";

async function talk(input: { entitySlug: string; channel: "phone" | "web"; language: "en" | "es"; lines: string[] }) {
  let view = await startReceptionistConversation({
    entitySlug: input.entitySlug,
    channel: input.channel,
    language: input.language,
  });
  for (const line of input.lines) {
    view = await postReceptionistMessage(view.data.conversation.id, { text: line });
  }
  return view;
}

describe("receptionist", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.RECEPTIONIST_SMS_PROVIDER;
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_PHONE_NUMBER;
  });

  it("matches an Adel customer in English, books an open slot, and records a sandbox SMS", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("ok", { status: 200 })));
    const { adel, office, admin } = await seedCompany();
    const hook = await createWebhookEndpoint(office, {
      url: "https://hooks.example.test/receptionist",
      events: ["request.created", "visit.booked", "job.scheduled", "safety.escalated"],
    });
    expect(hook.secret).toBeTruthy();
    const customer = await createCustomer(office, {
      brandId: adel.id,
      name: "Camille Calder",
      phone: "239-555-2201",
    });
    const location = await createProperty(office, customer.data.id, {
      label: "Gulf Shore house",
      line1: "1842 Gulf Shore Blvd N",
      city: "Naples",
      postalCode: "34102",
    });
    const taken = (await listOpenSlots(ADEL_ENTITY_ID))[0];
    expect(taken).toBeTruthy();
    const job = await createJob(office, {
      customerId: customer.data.id,
      propertyId: location.data.id,
      brandId: adel.id,
      title: "Already on the board",
    });
    const propertyId = location.data.id;
    await scheduleVisit(office, {
      jobId: job.data.id,
      scheduledStart: taken.start,
      scheduledEnd: taken.end,
    });

    const offered = await talk({
      entitySlug: "adel-electric",
      channel: "phone",
      language: "en",
      lines: ["Camille Calder", "239-555-2201", "1842 Gulf Shore Blvd N, Naples FL 34102", "The kitchen outlet stopped working"],
    });
    expect(offered.data.conversation.entityId).toBe(ADEL_ENTITY_ID);
    expect(offered.data.conversation.step).toBe("slots");
    expect(offered.data.slots.map((slot) => slot.start)).not.toContain(taken.start);
    expect(offered.data.messages.some((message) => message.body.includes("What's your name?") || message.bodyEn.includes("What's your name?"))).toBe(true);

    const booked = await postReceptionistMessage(offered.data.conversation.id, { text: "1" });
    expect(booked.data.conversation.outcome).toBe("booked");
    expect(booked.data.conversation.requestId).toBeTruthy();
    expect(booked.data.conversation.customerId).toBe(customer.data.id);
    expect(booked.data.conversation.propertyId).toBe(propertyId);
    const request = (await db.select().from(requests)).find((row) => row.id === booked.data.conversation.requestId);
    expect(request.entityId).toBe(ADEL_ENTITY_ID);
    expect(request.customerId).toBe(customer.data.id);
    const names = (await listCustomers(office, {})).data.filter((row) => row.name === "Camille Calder");
    expect(names).toHaveLength(1);
    const visit = (await db.select().from(visits)).find((row) => row.id === booked.data.conversation.visitId);
    expect(visit.entityId).toBe(ADEL_ENTITY_ID);
    expect(visit.scheduledStart.toISOString()).toBe(offered.data.slots[0].start);

    const sandbox = (await db.select().from(receptionistSandboxMessages)).filter((row) => row.conversationId === booked.data.conversation.id);
    expect(sandbox).toHaveLength(1);
    expect(sandbox[0]).toMatchObject({
      channel: "sms",
      kind: "booking_confirmation",
      provider: "sandbox",
      delivered: false,
      entityId: ADEL_ENTITY_ID,
    });
    expect(sandbox[0].body).toContain("tentative visit");
    expect(sandbox[0].toPhone).toContain("239-555-2201");

    const events = (await db.select().from(webhookDeliveries)).map((row) => row.event).sort();
    expect(events).toEqual(["job.scheduled", "job.scheduled", "request.created", "visit.booked"]);

    const serviceActor = asActor(admin, SERVICE_ENTITY_ID, [
      { entityId: SERVICE_ENTITY_ID, name: "Service Contracts", role: "admin" },
    ]);
    expect((await listRequests(serviceActor, {})).data.map((row) => row.id)).not.toContain(request.id);
    expect((await listReceptionistConversations(serviceActor)).data).toHaveLength(0);
    await expect(getReceptionistConversation(serviceActor, booked.data.conversation.id)).rejects.toMatchObject({ status: 404 });
    const token = await createApiToken(serviceActor, { name: "Service desk", role: "office" });
    const bearer = await authenticateBearer(`Bearer ${token.secret}`);
    await expect(getReceptionistConversation(bearer, booked.data.conversation.id)).rejects.toBeInstanceOf(AppError);
    const exported = await exportEntity(serviceActor);
    expect(JSON.stringify(exported.data)).not.toContain(booked.data.conversation.id);
    const adelExport = await exportEntity(office);
    expect(JSON.stringify(adelExport.data.receptionist)).toContain(booked.data.conversation.id);
  });

  it("books a Service Contracts website chat in Spanish and records the chat confirmation", async () => {
    const { office } = await seedCompany();
    const serviceActor = asActor(office, SERVICE_ENTITY_ID);
    const view = await talk({
      entitySlug: "service-contracts",
      channel: "web",
      language: "es",
      lines: ["Dana Ruiz", "941-555-0100", "15 Harbor Dr, Naples FL 34102", "El tomacorriente de la cocina no funciona", "1"],
    });
    expect(view.data.conversation.outcome).toBe("booked");
    expect(view.data.conversation.entityId).toBe(SERVICE_ENTITY_ID);
    expect(view.data.conversation.language).toBe("es");
    const greeting = view.data.messages[0];
    expect(greeting.body).toContain("Gracias");
    expect(greeting.bodyEn).toContain("Thanks");
    expect(greeting.bodyEn).not.toBe(greeting.body);
    const problem = view.data.messages.find((message) => message.body.includes("tomacorriente"));
    expect(problem?.bodyEn).toContain("outlet");
    expect(problem?.bodyEn).toContain("kitchen");
    const confirmation = view.data.messages.find((message) => message.body.includes("visita tentativa"));
    expect(confirmation?.bodyEn).toContain("tentative visit");
    const request = (await db.select().from(requests)).find((row) => row.id === view.data.conversation.requestId);
    expect(request?.entityId).toBe(SERVICE_ENTITY_ID);
    expect((await listRequests(office, {})).data.map((row) => row.id)).not.toContain(request?.id);
    const rows = (await db.select().from(requests)).filter((row) => row.id === request?.id);
    expect(rows).toHaveLength(1);
    const sandbox = (await db.select().from(receptionistSandboxMessages)).filter((row) => row.conversationId === view.data.conversation.id);
    expect(sandbox).toHaveLength(1);
    expect(sandbox[0]).toMatchObject({
      channel: "chat",
      kind: "chat_confirmation",
      provider: "sandbox",
      delivered: false,
      entityId: SERVICE_ENTITY_ID,
      toPhone: null,
    });
    expect(sandbox.some((row) => row.channel === "sms")).toBe(false);
    const samePhoneInAdel = (await db.select().from(customers)).filter((row) => row.entityId === ADEL_ENTITY_ID);
    expect(samePhoneInAdel).toHaveLength(0);
    expect((await listCustomers(serviceActor, {})).data.map((row) => row.id)).toContain(view.data.conversation.customerId);
  });

  it("does not match a customer who exists only in the other company", async () => {
    const { office } = await seedCompany();
    const serviceActor = asActor(office, SERVICE_ENTITY_ID);
    const other = await createCustomer(serviceActor, {
      brandId: SERVICE_BRAND_ID,
      name: "Pat Example",
      phone: "239-555-7777",
    });
    await createProperty(serviceActor, other.data.id, {
      label: "Dock",
      line1: "9 Dock",
      city: "Naples",
      postalCode: "34102",
    });
    const view = await talk({
      entitySlug: "adel-electric",
      channel: "phone",
      language: "en",
      lines: ["Pat Example", "239-555-7777", "9 Dock, Naples FL 34102", "A dimmer in the dining room failed", "1"],
    });
    expect(view.data.conversation.entityId).toBe(ADEL_ENTITY_ID);
    expect(view.data.conversation.customerId).not.toBe(other.data.id);
    const request = (await db.select().from(requests)).find((row) => row.id === view.data.conversation.requestId);
    expect(request?.entityId).toBe(ADEL_ENTITY_ID);
    expect(request?.customerId).not.toBe(other.data.id);
    expect((await listCustomers(serviceActor, {})).data.map((row) => row.id)).toEqual([other.data.id]);
    expect((await listRequests(serviceActor, {})).data).toHaveLength(0);
  });

  it("escalates a Spanish safety issue to the on-call person without booking or repair steps", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("ok", { status: 200 })));
    const { office, tech } = await seedCompany();
    await sql`update users set phone = ${"239-555-0172"} where id = ${tech.id}`;
    await updateReceptionistSettings(office, { onCallUserId: tech.id });
    await createWebhookEndpoint(office, {
      url: "https://hooks.example.test/safety",
      events: ["request.created", "visit.booked", "safety.escalated"],
    });
    const view = await talk({
      entitySlug: "adel-electric",
      channel: "phone",
      language: "es",
      lines: ["Camille Calder", "239-555-2201", "1842 Gulf Shore Blvd N, Naples", "Hay chispas y olor a quemado en el panel"],
    });
    expect(view.data.conversation.outcome).toBe("escalated");
    expect(view.data.conversation.visitId).toBeNull();
    expect(view.data.conversation.entityId).toBe(ADEL_ENTITY_ID);
    const caller = view.data.messages.find((message) => message.role === "caller" && message.body.includes("chispas"));
    expect(caller?.bodyEn).toContain("sparks");
    expect(caller?.bodyEn).toContain("burning smell");
    const script = view.data.messages.find((message) => message.bodyEn.includes("Stay clear"));
    expect(script?.bodyEn).toContain("Do not touch");
    expect(script?.bodyEn).toContain("fire or smoke");
    expect(script?.bodyEn).toContain("emergency services");
    expect(script?.body).toContain("No lo toque");
    expect(script?.bodyEn).not.toMatch(/breaker|rewire|turn off|replace the/i);
    const request = (await db.select().from(requests)).find((row) => row.id === view.data.conversation.requestId);
    expect(request?.entityId).toBe(ADEL_ENTITY_ID);
    const sandbox = (await db.select().from(receptionistSandboxMessages)).filter((row) => row.conversationId === view.data.conversation.id);
    expect(sandbox.map((row) => row.kind).sort()).toEqual(["safety_call", "safety_sms"]);
    for (const row of sandbox) {
      expect(row.provider).toBe("sandbox");
      expect(row.delivered).toBe(false);
      expect(row.toPhone).toBe("239-555-0172");
      expect(row.entityId).toBe(ADEL_ENTITY_ID);
    }
    expect(await db.select().from(visits)).toHaveLength(0);
    const events = (await db.select().from(webhookDeliveries)).map((row) => row.event).sort();
    expect(events).toEqual(["request.created", "safety.escalated"]);
  });

  it("creates nothing while the receptionist is off and accepts a new chat when it is on", async () => {
    const { office } = await seedCompany();
    await updateReceptionistSettings(office, { enabled: false });
    const off = await startReceptionistConversation({ entitySlug: "adel-electric", channel: "web", language: "en" });
    expect(off.data.conversation.outcome).toBe("off");
    expect(off.data.conversation.requestId).toBeNull();
    expect(off.data.messages[0].body).toContain("not taking receptionist messages");
    const nudged = await postReceptionistMessage(off.data.conversation.id, { text: "There are sparks and a burning smell" });
    expect(nudged.data.conversation.outcome).toBe("off");
    expect(await db.select().from(requests)).toHaveLength(0);
    expect(await db.select().from(receptionistSandboxMessages)).toHaveLength(0);

    await updateReceptionistSettings(office, { enabled: true });
    const on = await startReceptionistConversation({ entitySlug: "adel-electric", channel: "web", language: "en" });
    expect(on.data.conversation.outcome).toBe("collecting");
    const named = await postReceptionistMessage(on.data.conversation.id, { text: "Ada Lopez" });
    expect(named.data.conversation.step).toBe("phone");
    expect(await db.select().from(requests)).toHaveLength(0);
  });

  it("starts a conversation through the public REST route", async () => {
    await seedCompany();
    const response = await startRoute(
      new Request("http://localhost/api/v1/public/receptionist/conversations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entitySlug: "adel-electric", channel: "web", language: "en" }),
      }),
      { params: Promise.resolve({}) },
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { data: { conversation: { entityId: string; outcome: string }; messages: Array<{ bodyEn: string }> } };
    expect(body.data.conversation.entityId).toBe(ADEL_ENTITY_ID);
    expect(body.data.conversation.outcome).toBe("collecting");
    expect(body.data.messages[0].bodyEn).toContain("Adel Electric");
  });

  it("refuses the live telephony adapter without calling the network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    process.env.RECEPTIONIST_SMS_PROVIDER = "twilio";
    process.env.TWILIO_ACCOUNT_SID = "ACexampleaccount";
    process.env.TWILIO_AUTH_TOKEN = "example-auth-token";
    process.env.TWILIO_PHONE_NUMBER = "+15555550100";
    const provider = messagingProvider("sms");
    await expect(
      provider.deliver(
        {
          entityId: ADEL_ENTITY_ID,
          conversationId: ADEL_ENTITY_ID,
          channel: "sms",
          kind: "booking_confirmation",
          toPhone: "+15555550199",
          body: "hello",
          bodyEn: "hello",
        },
        undefined as never,
      ),
    ).rejects.toMatchObject({ code: "live_provider_disabled" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
