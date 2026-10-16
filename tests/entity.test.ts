import { readFileSync } from "node:fs";
import path from "node:path";
import { ADEL_ENTITY_ID, SERVICE_BRAND_ID, SERVICE_ENTITY_ID } from "@adel/db";
import {
  AppError,
  authenticateBearer,
  createApiToken,
  createContract,
  createCustomer,
  exportEntity,
  getCustomer,
  linkCustomers,
  listContracts,
  listCustomers,
  listVisits,
} from "@adel/core";
import { describe, expect, it } from "vitest";
import { GET as listCustomersRoute } from "../apps/web/src/app/api/v1/customers/route";
import { asActor, seedCompany } from "./helpers";

describe("entity partition", () => {
  it("keeps a token, a session, and the MCP customer route inside one company", async () => {
    const { admin, office, adel } = await seedCompany();
    const adelCustomer = await createCustomer(office, { brandId: adel.id, name: "Adel Only" });
    const serviceActor = asActor(admin, SERVICE_ENTITY_ID, [
      { entityId: SERVICE_ENTITY_ID, name: "Service Contracts", role: "admin" },
    ]);
    const serviceCustomer = await createCustomer(serviceActor, { brandId: SERVICE_BRAND_ID, name: "Contract Only" });

    const adelList = await listCustomers(office, {});
    expect(adelList.data.map((row) => row.name)).toContain("Adel Only");
    expect(adelList.data.map((row) => row.name)).not.toContain("Contract Only");
    await expect(getCustomer(office, serviceCustomer.data.id)).rejects.toMatchObject({ status: 404 });

    const onlyAdel = asActor(office, ADEL_ENTITY_ID, [{ entityId: ADEL_ENTITY_ID, name: "Adel Electric", role: "office" }]);
    await expect(getCustomer(onlyAdel, serviceCustomer.data.id)).rejects.toBeInstanceOf(AppError);

    const adelToken = await createApiToken(admin, { name: "Adel books", role: "office" });
    const serviceToken = await createApiToken(serviceActor, { name: "Contract books", role: "office" });
    const adelBearer = await authenticateBearer(`Bearer ${adelToken.secret}`);
    const serviceBearer = await authenticateBearer(`Bearer ${serviceToken.secret}`);
    expect(adelBearer.entityId).toBe(ADEL_ENTITY_ID);
    expect(adelBearer.entityIds).toEqual([ADEL_ENTITY_ID]);
    expect((await listCustomers(adelBearer, {})).data.map((row) => row.id)).not.toContain(serviceCustomer.data.id);
    await expect(getCustomer(serviceBearer, adelCustomer.data.id)).rejects.toMatchObject({ status: 404 });
    await expect(createCustomer(adelBearer, { brandId: SERVICE_BRAND_ID, name: "Wrong book" })).rejects.toBeInstanceOf(AppError);

    const adelResponse = await listCustomersRoute(
      new Request("http://localhost/api/v1/customers", { headers: { authorization: `Bearer ${adelToken.secret}` } }),
      { params: Promise.resolve({}) },
    );
    const serviceResponse = await listCustomersRoute(
      new Request("http://localhost/api/v1/customers", { headers: { authorization: `Bearer ${serviceToken.secret}` } }),
      { params: Promise.resolve({}) },
    );
    const adelBody = (await adelResponse.json()) as { data: Array<{ name: string }> };
    const serviceBody = (await serviceResponse.json()) as { data: Array<{ name: string }> };
    expect(adelBody.data.map((row) => row.name)).toEqual(["Adel Only"]);
    expect(serviceBody.data.map((row) => row.name)).toEqual(["Contract Only"]);

    const tools = readFileSync(path.join(process.cwd(), "packages/mcp/src/tools.ts"), "utf8");
    expect(tools).toContain('call("GET", `/api/v1/customers');
    expect(tools).toContain('call("GET", `/api/v1/visits');
    expect(tools).toContain('call("POST", "/api/v1/invoices"');

    const exported = await exportEntity(office);
    expect(exported.data.customers.map((row) => row.name)).toEqual(["Adel Only"]);
    expect(exported.data.entity.id).toBe(ADEL_ENTITY_ID);
    const serviceExport = await exportEntity(serviceActor);
    expect(serviceExport.data.customers.map((row) => row.name)).toEqual(["Contract Only"]);
    expect(JSON.stringify(serviceExport.data)).not.toContain(adelCustomer.data.id);
  });

  it("shows both companies on the shared board and writes a contract into one company", async () => {
    const { office, tech, adel } = await seedCompany();
    const serviceActor = asActor(office, SERVICE_ENTITY_ID, [
      { entityId: SERVICE_ENTITY_ID, name: "Service Contracts", role: "office" },
      { entityId: ADEL_ENTITY_ID, name: "Adel Electric", role: "office" },
    ]);
    serviceActor.entityId = SERVICE_ENTITY_ID;
    serviceActor.role = "office";
    const customer = await createCustomer(serviceActor, { brandId: SERVICE_BRAND_ID, name: "Harbour Contract" });
    const property = customer.data.properties;
    expect(property).toEqual([]);
    const { createProperty, createJob, scheduleVisit } = await import("@adel/core");
    const location = await createProperty(serviceActor, customer.data.id, {
      label: "House",
      line1: "9 Dock",
      city: "Naples",
      postalCode: "34102",
    });
    const job = await createJob(serviceActor, {
      customerId: customer.data.id,
      propertyId: location.data.id,
      brandId: SERVICE_BRAND_ID,
      title: "Contract visit",
    });
    const start = new Date("2026-10-16T15:00:00.000Z");
    await scheduleVisit(serviceActor, {
      jobId: job.data.id,
      technicianId: tech.id,
      scheduledStart: start.toISOString(),
      scheduledEnd: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
    });
    const board = await listVisits(tech, { day: "2026-10-16", board: true });
    expect(board.data.some((visit) => visit.entityName === "Service Contracts" && visit.customerName === "Harbour Contract")).toBe(true);
    const adelOnly = await listVisits(asActor(tech, ADEL_ENTITY_ID, [{ entityId: ADEL_ENTITY_ID, name: "Adel Electric", role: "tech" }]), {
      day: "2026-10-16",
    });
    expect(adelOnly.data.some((visit) => visit.customerName === "Harbour Contract")).toBe(false);

    await createContract(serviceActor, {
      customerId: customer.data.id,
      propertyId: location.data.id,
      startsOn: "2026-11-01",
      endsOn: "2027-11-01",
      status: "active",
      notes: "Annual service.",
    });
    expect((await listContracts(office)).data).toHaveLength(0);
    expect((await listContracts(serviceActor)).data).toHaveLength(1);

    const adelCustomer = await createCustomer(office, { brandId: adel.id, name: "Same person, other book" });
    const link = await linkCustomers(
      { ...office, entityId: ADEL_ENTITY_ID },
      { customerId: adelCustomer.data.id, otherEntityId: SERVICE_ENTITY_ID, otherCustomerId: customer.data.id },
    );
    expect(link.data.fromRecordId).toBe(adelCustomer.data.id);
    expect(link.data.toRecordId).toBe(customer.data.id);
    const again = await exportEntity(office);
    expect(again.data.links).toHaveLength(1);
    expect(again.data.customers.some((row) => row.id === customer.data.id)).toBe(false);
  });
});
