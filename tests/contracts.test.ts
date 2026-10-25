import { ADEL_ENTITY_ID, SERVICE_BRAND_ID, SERVICE_ENTITY_ID, sql } from "@adel/db";
import { zonedDateTime } from "@adel/db/zoned";
import {
  AppError,
  completeVisit,
  createApiToken,
  createContract,
  createContractSchedule,
  createCustomer,
  createProperty,
  createWebhookEndpoint,
  exportEntity,
  getContract,
  listContracts,
  listInvoices,
  listUpcomingRenewals,
  listVisits,
  maintainServiceContracts,
  renewContract,
  shiftOffHoliday,
  skipContractOccurrence,
  updateContract,
  updateContractSchedule,
  updateVisit,
  weekdayIndex,
} from "@adel/core";
import { describe, expect, it } from "vitest";
import { GET as listContractsRoute } from "../apps/web/src/app/api/v1/contracts/route";
import { POST as createContractRoute } from "../apps/web/src/app/api/v1/contracts/route";
import { GET as renewalsRoute } from "../apps/web/src/app/api/v1/contracts/renewals/route";
import { asActor, seedCompany } from "./helpers";

const NOW = new Date("2026-10-25T15:00:00.000Z");

function serviceOffice(user: { id: string; name: string; email: string; role: "admin" | "office" | "tech" }) {
  return asActor(user, SERVICE_ENTITY_ID, [
    { entityId: SERVICE_ENTITY_ID, name: "Service Contracts", role: user.role },
    { entityId: ADEL_ENTITY_ID, name: "Adel Electric", role: user.role },
  ]);
}

async function serviceCustomer(actor: ReturnType<typeof serviceOffice>, name = "Harbour Lights HOA") {
  const customer = await createCustomer(actor, { brandId: SERVICE_BRAND_ID, name });
  const property = await createProperty(actor, customer.data.id, {
    label: "Clubhouse",
    line1: "400 Harbour Drive",
    city: "Naples",
    postalCode: "34102",
  });
  const other = await createProperty(actor, customer.data.id, {
    label: "Gatehouse",
    line1: "1 Harbour Drive",
    city: "Naples",
    postalCode: "34102",
  });
  return { customer, property, other };
}

describe("contract dates", () => {
  it("moves weekends and federal holidays to the next weekday", () => {
    expect(weekdayIndex("2026-11-01")).toBe(0);
    expect(shiftOffHoliday("2026-11-01")).toEqual({ occursOn: "2026-11-02", shifted: true });
    expect(shiftOffHoliday("2026-12-25")).toEqual({ occursOn: "2026-12-28", shifted: true });
    expect(shiftOffHoliday("2026-07-04")).toEqual({ occursOn: "2026-07-06", shifted: true });
    expect(shiftOffHoliday("2026-07-03").occursOn).toBe("2026-07-06");
    expect(shiftOffHoliday("2026-10-20")).toEqual({ occursOn: "2026-10-20", shifted: false });
    expect(shiftOffHoliday("2027-01-01").occursOn).toBe("2027-01-04");
  });
});

describe("service contract schedules and renewals", () => {
  it("generates a rolling horizon, keeps hand edits, and skips a date for good", async () => {
    const { office, tech } = await seedCompany();
    const actor = serviceOffice(office);
    const { customer, property } = await serviceCustomer(actor);
    const created = await createContract(
      actor,
      {
        customerId: customer.data.id,
        propertyId: property.data.id,
        title: "Clubhouse maintenance",
        startsOn: "2026-10-01",
        endsOn: "2027-10-01",
        status: "active",
        priceCents: 0,
        schedule: {
          frequency: "monthly",
          anchorOn: "2026-10-01",
          localStart: "09:00",
          durationMinutes: 90,
          horizonDays: 70,
          technicianId: tech.id,
          title: "Monthly check",
        },
      },
      NOW,
    );
    const byDay = new Map(created.data.schedules[0].occurrences.map((row) => [row.originalOn, row]));
    expect([...byDay.keys()].sort()).toEqual(["2026-11-01", "2026-12-01", "2027-01-01"]);
    expect(byDay.get("2026-11-01")?.occursOn).toBe("2026-11-02");
    expect(byDay.get("2026-11-01")?.status).toBe("shifted");
    expect(byDay.get("2027-01-01")?.occursOn).toBe("2027-01-04");
    expect(byDay.get("2026-12-01")?.occursOn).toBe("2026-12-01");

    const board = await listVisits(tech, { day: "2026-11-02", board: true });
    expect(board.data.some((visit) => visit.entityName === "Service Contracts" && visit.customerName === "Harbour Lights HOA")).toBe(true);
    const adelOnly = await listVisits(asActor(tech, ADEL_ENTITY_ID, [{ entityId: ADEL_ENTITY_ID, name: "Adel Electric", role: "tech" }]), {
      day: "2026-11-02",
    });
    expect(adelOnly.data.some((visit) => visit.customerName === "Harbour Lights HOA")).toBe(false);
    expect((await listContracts(office)).data).toHaveLength(0);

    const november = byDay.get("2026-11-01");
    const december = byDay.get("2026-12-01");
    const january = byDay.get("2027-01-01");
    if (!november?.visitId || !december?.visitId || !january?.visitId) throw new Error("missing visit");
    await completeVisit(actor, november.visitId);
    const movedStart = zonedDateTime("2026-12-01", "15:00", "America/New_York");
    const movedEnd = zonedDateTime("2026-12-01", "16:30", "America/New_York");
    await updateVisit(actor, december.visitId, { scheduledStart: movedStart.toISOString(), scheduledEnd: movedEnd.toISOString() });
    const scheduleId = created.data.schedules[0].id;
    const edited = await updateContractSchedule(actor, created.data.id, scheduleId, { localStart: "13:00" }, NOW);
    const again = new Map(edited.data.schedules[0].occurrences.map((row) => [row.originalOn, row]));
    expect(again.get("2026-11-01")?.visitStatus).toBe("completed");
    expect(new Date(again.get("2026-11-01")?.scheduledStart ?? 0).toISOString()).toBe(zonedDateTime("2026-11-02", "09:00", "America/New_York").toISOString());
    expect(new Date(again.get("2026-12-01")?.scheduledStart ?? 0).toISOString()).toBe(movedStart.toISOString());
    expect(again.get("2026-12-01")?.pinned).toBe(true);
    expect(new Date(again.get("2027-01-01")?.scheduledStart ?? 0).toISOString()).toBe(zonedDateTime("2027-01-04", "13:00", "America/New_York").toISOString());

    const skipped = await skipContractOccurrence(actor, created.data.id, january.id, { reason: "Customer away" }, NOW);
    const januaryAfter = skipped.data.schedules[0].occurrences.find((row) => row.originalOn === "2027-01-01");
    expect(januaryAfter?.status).toBe("skipped");
    expect(januaryAfter?.visitStatus).toBe("canceled");
    const maintained = await maintainServiceContracts(actor, NOW);
    expect(maintained.data.visitsCreated).toBe(0);
    const still = await getContract(actor, created.data.id);
    const januaryStill = still.data.schedules[0].occurrences.filter((row) => row.originalOn === "2027-01-01");
    expect(januaryStill).toHaveLength(1);
    expect(januaryStill[0]?.visitStatus).toBe("canceled");
  });

  it("bills each due period once and mirrors a Stripe test invoice without a live key", async () => {
    const previousKey = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    const { office } = await seedCompany();
    const actor = serviceOffice(office);
    const { customer, property, other } = await serviceCustomer(actor, "Pelican Watch");
    const calls: unknown[] = [];
    const stripe = {
      customers: {
        create: async (args: unknown) => {
          calls.push(["customer", args]);
          return { id: "cus_test_contract" };
        },
      },
      invoices: {
        create: async (args: unknown) => {
          calls.push(["invoice", args]);
          return { id: "in_test_contract" };
        },
        finalizeInvoice: async (id: string) => {
          calls.push(["finalize", id]);
          return { id };
        },
      },
      invoiceItems: {
        create: async (args: unknown) => {
          calls.push(["item", args]);
          return { id: "ii_test_contract" };
        },
      },
    };
    const created = await createContract(
      actor,
      {
        customerId: customer.data.id,
        propertyId: property.data.id,
        propertyIds: [other.data.id],
        title: "Gate and clubhouse",
        startsOn: "2026-09-01",
        endsOn: "2027-09-01",
        status: "active",
        priceCents: 15000,
        billingFrequency: "monthly",
        scope: "Test gates, replace lamps that are already on the truck.",
        equipment: [{ name: "Gate operator", propertyId: other.data.id, location: "North gate", serial: "G-14" }],
      },
      NOW,
    );
    expect(created.data.coveredProperties.map((row) => row.label).sort()).toEqual(["Clubhouse", "Gatehouse"]);
    expect(created.data.charges.map((row) => row.periodStart)).toEqual(["2026-09-01", "2026-10-01"]);
    expect(created.data.charges.every((row) => row.invoiceStatus === "issued")).toBe(true);
    await maintainServiceContracts(actor, NOW, { stripe });
    const billed = await getContract(actor, created.data.id);
    expect(billed.data.charges).toHaveLength(2);
    expect(billed.data.charges[0]?.stripeInvoiceId).toBe("in_test_contract");
    const item = calls.find((entry) => Array.isArray(entry) && entry[0] === "item") as [string, { amount: number; currency: string }];
    expect(item[1].amount).toBe(15000);
    expect(item[1].currency).toBe("usd");
    const stripeInvoice = calls.find((entry) => Array.isArray(entry) && entry[0] === "invoice") as [string, { metadata: { entityId: string } }];
    expect(stripeInvoice[1].metadata.entityId).toBe(SERVICE_ENTITY_ID);
    expect(JSON.stringify(calls)).not.toContain("sk_live_");

    expect((await listInvoices(office, {})).data).toHaveLength(0);
    const adelExport = await exportEntity(office);
    const serviceExport = await exportEntity(actor);
    expect(adelExport.data.contracts).toHaveLength(0);
    expect(JSON.stringify(adelExport.data)).not.toContain("Gate operator");
    expect(serviceExport.data.contractEquipment.map((row) => row.name)).toEqual(["Gate operator"]);
    expect(serviceExport.data.invoices).toHaveLength(2);
    await expect(getContract(office, created.data.id)).rejects.toBeInstanceOf(AppError);

    process.env.STRIPE_SECRET_KEY = "sk_live_not_allowed";
    try {
      const fresh = await serviceCustomer(actor, "Live Key Refuse");
      await expect(
        createContract(
          actor,
          {
            customerId: fresh.customer.data.id,
            propertyId: fresh.property.data.id,
            title: "Should not call Stripe",
            startsOn: "2026-10-01",
            endsOn: "2027-10-01",
            status: "active",
            priceCents: 5000,
            billingFrequency: "monthly",
          },
          NOW,
        ),
      ).rejects.toMatchObject({ code: "stripe_live_key_blocked" });
    } finally {
      if (previousKey === undefined) delete process.env.STRIPE_SECRET_KEY;
      else process.env.STRIPE_SECRET_KEY = previousKey;
    }
  });

  it("reminds, renews with a new price, auto-renews, and lapses", async () => {
    const { office, admin } = await seedCompany();
    const actor = serviceOffice(office);
    const adminActor = serviceOffice(admin);
    const hook = await createWebhookEndpoint(actor, {
      url: "https://hooks.example.test/contracts",
      events: ["contract.renewal_due", "contract.renewed", "contract.lapsed", "contract.canceled", "invoice.issued"],
    });
    expect(hook.secret).toBeTruthy();
    const { customer, property } = await serviceCustomer(actor, "Coconut Point");
    const due = await createContract(
      actor,
      {
        customerId: customer.data.id,
        propertyId: property.data.id,
        title: "Lighting agreement",
        startsOn: "2026-01-14",
        endsOn: "2026-11-14",
        status: "active",
        priceCents: 120000,
        billingFrequency: "annual",
        reminderDays: 30,
        renewalTermMonths: 12,
      },
      NOW,
    );
    const upcoming = await listUpcomingRenewals(actor, 60, NOW);
    expect(upcoming.data.map((row) => row.id)).toContain(due.data.id);
    expect(upcoming.data.find((row) => row.id === due.data.id)?.daysLeft).toBe(20);
    const renewed = await renewContract(actor, due.data.id, { priceCents: 135000 }, NOW);
    expect(renewed.data.endsOn).toBe("2027-11-14");
    expect(renewed.data.priceCents).toBe(135000);
    expect(renewed.data.status).toBe("active");
    expect(renewed.data.renewals[0]?.previousPriceCents).toBe(120000);
    expect(renewed.data.renewals[0]?.source).toBe("manual");

    const { customer: autoCustomer, property: autoProperty } = await serviceCustomer(actor, "Auto Plaza");
    const auto = await createContract(
      actor,
      {
        customerId: autoCustomer.data.id,
        propertyId: autoProperty.data.id,
        title: "Auto renewal",
        startsOn: "2025-10-25",
        endsOn: "2026-10-25",
        status: "active",
        priceCents: 0,
        autoRenew: true,
        renewalTermMonths: 12,
      },
      NOW,
    );
    expect(auto.data.endsOn).toBe("2027-10-25");
    expect(auto.data.renewals.some((row) => row.source === "auto")).toBe(true);

    const { customer: lapseCustomer, property: lapseProperty } = await serviceCustomer(actor, "Lapse Marina");
    const lapse = await createContract(
      actor,
      {
        customerId: lapseCustomer.data.id,
        propertyId: lapseProperty.data.id,
        title: "Seasonal docks",
        startsOn: "2026-10-01",
        endsOn: "2026-12-31",
        status: "active",
        priceCents: 0,
        autoRenew: false,
      },
      NOW,
    );
    await createContractSchedule(
      actor,
      lapse.data.id,
      { frequency: "monthly", anchorOn: "2026-11-01", horizonDays: 40, title: "Dock check", localStart: "10:00" },
      NOW,
    );
    const scheduled = await getContract(actor, lapse.data.id);
    expect(scheduled.data.schedules[0].occurrences.some((row) => row.visitStatus === "scheduled")).toBe(true);
    await updateContract(actor, lapse.data.id, { endsOn: "2026-10-24" }, NOW);
    const lapsed = await getContract(actor, lapse.data.id);
    expect(lapsed.data.status).toBe("lapsed");
    const lapsedVisits = await listVisits(actor, { day: "2026-11-02" });
    expect(lapsedVisits.data.find((visit) => visit.customerName === "Lapse Marina")?.status).toBe("canceled");
    const broughtBack = await renewContract(actor, lapse.data.id, {}, NOW);
    expect(broughtBack.data.status).toBe("active");
    expect(broughtBack.data.endsOn).toBe("2027-10-25");
    expect(broughtBack.data.schedules[0].occurrences.some((row) => row.visitStatus === "scheduled")).toBe(true);

    const events = (
      await sql<{ event: string }[]>`select event from webhook_deliveries where endpoint_id = ${hook.data.id}`
    ).map((row) => row.event);
    expect(events).toContain("contract.renewal_due");
    expect(events).toContain("contract.renewed");
    expect(events).toContain("contract.lapsed");

    const token = await createApiToken(adminActor, { name: "Service books", role: "office" });
    const adelToken = await createApiToken(admin, { name: "Adel books", role: "office" });
    const created = await createContractRoute(
      new Request("http://localhost/api/v1/contracts", {
        method: "POST",
        headers: { authorization: `Bearer ${token.secret}`, "content-type": "application/json" },
        body: JSON.stringify({
          customerId: customer.data.id,
          propertyId: property.data.id,
          title: "API contract",
          startsOn: "2026-10-01",
          endsOn: "2027-04-01",
          status: "active",
          priceCents: 0,
        }),
      }),
      { params: Promise.resolve({}) },
    );
    expect(created.status).toBe(201);
    const body = (await created.json()) as { data: { id: string } };
    const listed = await listContractsRoute(
      new Request("http://localhost/api/v1/contracts", { headers: { authorization: `Bearer ${adelToken.secret}` } }),
      { params: Promise.resolve({}) },
    );
    const listedBody = (await listed.json()) as { data: Array<{ id: string }> };
    expect(listedBody.data.map((row) => row.id)).not.toContain(body.data.id);
    const renewals = await renewalsRoute(
      new Request("http://localhost/api/v1/contracts/renewals", { headers: { authorization: `Bearer ${token.secret}` } }),
      { params: Promise.resolve({}) },
    );
    expect(renewals.status).toBe(200);
    const renewalBody = (await renewals.json()) as { data: Array<{ id: string }> };
    expect(renewalBody.data.map((row) => row.id)).not.toContain(lapse.data.id);
  });

  it("places a custom interval on weekdays and cancels future visits", async () => {
    const { office } = await seedCompany();
    const actor = serviceOffice(office);
    const { customer, property } = await serviceCustomer(actor, "Custom cadence");
    const created = await createContract(
      actor,
      {
        customerId: customer.data.id,
        propertyId: property.data.id,
        title: "Biweekly",
        startsOn: "2026-10-26",
        endsOn: "2027-10-26",
        status: "active",
        priceCents: 0,
        schedule: {
          frequency: "custom",
          intervalCount: 2,
          intervalUnit: "week",
          anchorOn: "2026-10-26",
          horizonDays: 21,
          title: "Filter round",
        },
      },
      NOW,
    );
    expect(created.data.schedules[0].occurrences.map((row) => row.occursOn)).toEqual(["2026-10-26", "2026-11-09"]);
    const canceled = await (await import("@adel/core")).cancelContract(actor, created.data.id, NOW);
    expect(canceled.data.status).toBe("canceled");
    expect(canceled.data.schedules[0].occurrences.every((row) => row.status === "skipped" || row.visitStatus === "canceled")).toBe(true);
  });
});
