import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
config({ path: path.join(root, ".env") });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");
}
if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) && process.env.ALLOW_REMOTE_SEED !== "yes") {
  throw new Error("Refusing to seed a non-local database. Set ALLOW_REMOTE_SEED=yes to override.");
}

const bcrypt = (await import("bcryptjs")).default;
const { eq } = await import("drizzle-orm");
const { hashSecret, newSecret } = await import("./secrets");
const { companyToday, zonedDateTime } = await import("./zoned");
const { truncateAll } = await import("./reset");
const { ADEL_ENTITY_ID, SERVICE_BRAND_ID, SERVICE_ENTITY_ID } = await import("./ids");
const { db, sql } = await import("./client");
const schema = await import("./schema");

const {
  apiTokens,
  brands,
  companySettings,
  entities,
  entityMemberships,
  counters,
  customers,
  formTemplates,
  invoiceLineItems,
  invoices,
  jobs,
  properties,
  quoteLineItems,
  quotes,
  requests,
  users,
  visitForms,
  deviceTokens,
  locationPoints,
  speechTerms,
  visitNotes,
  visits,
  catalogItems,
  intercompanyRates,
} = schema;

const existing = await db.select({ id: users.id }).from(users).limit(1);
if (process.env.SEED_RESET === "yes") {
  await truncateAll();
} else if (existing.length) {
  console.log("Database already has users. Set SEED_RESET=yes to wipe and reseed.");
  await sql.end();
  process.exit(0);
}

const passwordHash = await bcrypt.hash("Fieldnote-demo-2026", 10);
const timeZone = "America/New_York";
const today = companyToday(timeZone);

await db.insert(companySettings).values({
  id: "default",
  legalName: "Adel Electric, LLC",
  timeZone,
  defaultTaxRateBps: 700,
  taxLabel: "Estimated Florida sales tax",
  requireSignatureToComplete: true,
  shopAddress: "4180 Enterprise Avenue, Naples, FL 34104",
});

await db.insert(entities).values([
  { id: ADEL_ENTITY_ID, name: "Adel Electric", slug: "adel-electric", taxRateBps: 700, taxLabel: "Estimated Florida sales tax" },
  { id: SERVICE_ENTITY_ID, name: "Service Contracts", slug: "service-contracts", taxRateBps: 700, taxLabel: "Estimated Florida sales tax" },
]);

const [adel] = await db.insert(brands).values({ entityId: ADEL_ENTITY_ID, name: "Adel Electric", slug: "adel-electric" }).returning();
await db.insert(brands).values({ id: SERVICE_BRAND_ID, entityId: SERVICE_ENTITY_ID, name: "Service Contracts", slug: "service-contracts" });

const [alan] = await db
  .insert(users)
  .values({ name: "Alan Drespel", email: "alan@adel.example", passwordHash, role: "admin", phone: "239-555-0140" })
  .returning();
const [renee] = await db
  .insert(users)
  .values({ name: "Renee Okonkwo", email: "renee.okonkwo@adel.example", passwordHash, role: "office", phone: "239-555-0148" })
  .returning();
const [marco] = await db
  .insert(users)
  .values({ name: "Marco Vell", email: "marco.vell@adel.example", passwordHash, role: "tech", phone: "239-555-0172" })
  .returning();
const [sofia] = await db
  .insert(users)
  .values({ name: "Sofia Brennan", email: "sofia.brennan@adel.example", passwordHash, role: "tech", phone: "239-555-0194" })
  .returning();

await db.insert(entityMemberships).values(
  [alan, renee, marco, sofia].flatMap((person) => [
    { userId: person.id, entityId: ADEL_ENTITY_ID, role: person.role },
    { userId: person.id, entityId: SERVICE_ENTITY_ID, role: person.role },
  ]),
);

async function addCustomer(input: {
  brandId: string;
  name: string;
  email: string;
  phone: string;
  notes: string;
  property: { label: string; line1: string; city: string; postalCode: string; accessNotes: string; latitude: number; longitude: number };
}) {
  const [customer] = await db
    .insert(customers)
    .values({
      entityId: ADEL_ENTITY_ID,
      brandId: input.brandId,
      name: input.name,
      email: input.email,
      phone: input.phone,
      notes: input.notes,
    })
    .returning();
  const [property] = await db
    .insert(properties)
    .values({ entityId: ADEL_ENTITY_ID, customerId: customer.id, state: "FL", ...input.property })
    .returning();
  return { customer, property };
}

const camille = await addCustomer({
  brandId: adel.id,
  name: "Camille Calder",
  email: "camille.calder@example.net",
  phone: "239-555-2201",
  notes: "Prefers morning calls. Panel is in the garage.",
  property: {
    label: "Gulf Shore house",
    line1: "1842 Gulf Shore Blvd N",
    city: "Naples",
    postalCode: "34102",
    accessNotes: "Gate code 1947. Two dogs stay in the lanai until noon.",
    latitude: 26.2126,
    longitude: -81.807,
  },
});

const helen = await addCustomer({
  brandId: adel.id,
  name: "Helen Cho",
  email: "helen.cho@example.net",
  phone: "941-555-2288",
  notes: "Kitchen remodel with a local cabinet shop. Wants dimmers on the island.",
  property: {
    label: "Harbour house",
    line1: "401 S Palm Ave",
    city: "Sarasota",
    postalCode: "34236",
    accessNotes: "Park in the drive, not on the brick street. Lockbox 4419 on the side gate.",
    latitude: 27.3364,
    longitude: -82.5406,
  },
});

const anya = await addCustomer({
  brandId: adel.id,
  name: "Anya Shah",
  email: "anya.shah@example.net",
  phone: "305-555-2144",
  notes: "EV charger on the carport plus a generator interlock. HOA requires a permit card on site.",
  property: {
    label: "Coral Gables residence",
    line1: "728 Alhambra Cir",
    city: "Coral Gables",
    postalCode: "33134",
    accessNotes: "Call from the gate. Carport is behind the house. Do not block the neighbor's easement.",
    latitude: 25.749,
    longitude: -80.258,
  },
});

const marcus = await addCustomer({
  brandId: adel.id,
  name: "Marcus Bell",
  email: "marcus.bell@example.net",
  phone: "561-555-2190",
  notes: "Facade and landscape lighting. Wants the path lights warm, not blue.",
  property: {
    label: "Ocean boulevard house",
    line1: "55 Via Marina",
    city: "Palm Beach",
    postalCode: "33480",
    accessNotes: "Use the service alley. Irrigation timer is in the garage.",
    latitude: 26.705,
    longitude: -80.037,
  },
});

const [panelRequest] = await db
  .insert(requests)
  .values({
    entityId: ADEL_ENTITY_ID,
    customerId: camille.customer.id,
    propertyId: camille.property.id,
    brandId: adel.id,
    title: "Whole-home surge and panel capacity",
    description: "Lights dim when the oven and the dryer run together. Camille wants a panel assessment and a whole-home surge device.",
    status: "new",
    source: "phone",
    createdById: renee.id,
  })
  .returning();

const [helenQuote] = await db
  .insert(quotes)
  .values({
    entityId: ADEL_ENTITY_ID,
    number: 1001,
    customerId: helen.customer.id,
    propertyId: helen.property.id,
    brandId: adel.id,
    title: "Kitchen circuit package",
    status: "sent",
    taxRateBps: 700,
    notes: "Includes island receptacles, under-cabinet feeds, and a dedicated circuit for the warming drawer. Does not include patching paint.",
    publicToken: "q_seed_helen_cho_kitchen",
    sentAt: new Date(),
    validUntil: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000),
  })
  .returning();
await db.insert(quoteLineItems).values([
  { quoteId: helenQuote.id, position: 0, kind: "labor", description: "Kitchen circuit labor", quantity: "6.00", unitAmountCents: 13500, taxable: false },
  { quoteId: helenQuote.id, position: 1, kind: "material", description: "Devices, dimmers, and wire", quantity: "1.00", unitAmountCents: 64000, taxable: true },
]);
await db.insert(requests).values({
  entityId: ADEL_ENTITY_ID,
  customerId: helen.customer.id,
  propertyId: helen.property.id,
  brandId: adel.id,
  title: "Kitchen remodel circuits",
  description: "Cabinet shop is ready for the electrician the week of the counter install.",
  status: "quoted",
  source: "email",
  createdById: renee.id,
});

async function addApprovedQuote(input: {
  number: number;
  customerId: string;
  propertyId: string;
  brandId: string;
  title: string;
  notes: string;
  lines: Array<{ kind: "labor" | "material" | "other"; description: string; quantity: string; unitAmountCents: number; taxable: boolean }>;
  approvedByName: string;
}) {
  const [quote] = await db
    .insert(quotes)
    .values({
      entityId: ADEL_ENTITY_ID,
      number: input.number,
      customerId: input.customerId,
      propertyId: input.propertyId,
      brandId: input.brandId,
      title: input.title,
      notes: input.notes,
      status: "approved",
      taxRateBps: 700,
      approvedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      approvedByName: input.approvedByName,
      sentAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
    })
    .returning();
  await db.insert(quoteLineItems).values(input.lines.map((line, position) => ({ quoteId: quote.id, position, ...line })));
  return quote;
}

const anyaQuote = await addApprovedQuote({
  number: 1002,
  customerId: anya.customer.id,
  propertyId: anya.property.id,
  brandId: adel.id,
  title: "EV charger and generator interlock",
  notes: "40A charger on the carport. Interlock kit on the existing panel. Permit by Adel Electric.",
  approvedByName: "Anya Shah",
  lines: [
    { kind: "labor", description: "Charger and interlock labor", quantity: "5.00", unitAmountCents: 14500, taxable: false },
    { kind: "material", description: "Level 2 charger", quantity: "1.00", unitAmountCents: 78500, taxable: true },
    { kind: "material", description: "Interlock kit and breaker", quantity: "1.00", unitAmountCents: 24000, taxable: true },
  ],
});

const marcusQuote = await addApprovedQuote({
  number: 1003,
  customerId: marcus.customer.id,
  propertyId: marcus.property.id,
  brandId: adel.id,
  title: "Facade and path lighting",
  notes: "Warm path lights along the south walk and two facade uplights. Transformer in the garage.",
  approvedByName: "Marcus Bell",
  lines: [
    { kind: "labor", description: "Landscape lighting labor", quantity: "8.00", unitAmountCents: 12500, taxable: false },
    { kind: "material", description: "Fixtures, transformer, and cable", quantity: "1.00", unitAmountCents: 186000, taxable: true },
  ],
});

async function addJob(input: {
  number: number;
  quoteId: string;
  customerId: string;
  propertyId: string;
  brandId: string;
  title: string;
  instructions: string;
  status: "scheduled" | "in_progress" | "completed";
}) {
  const [job] = await db.insert(jobs).values({ ...input, entityId: ADEL_ENTITY_ID }).returning();
  return job;
}

const anyaJob = await addJob({
  number: 1001,
  quoteId: anyaQuote.id,
  customerId: anya.customer.id,
  propertyId: anya.property.id,
  brandId: adel.id,
  title: anyaQuote.title,
  instructions: "Pull the permit card from the truck book. Confirm the charger model before opening the box.",
  status: "scheduled",
});
const marcusJob = await addJob({
  number: 1002,
  quoteId: marcusQuote.id,
  customerId: marcus.customer.id,
  propertyId: marcus.property.id,
  brandId: adel.id,
  title: marcusQuote.title,
  instructions: "Customer wants the path lights at 2700K. Photo the transformer nameplate.",
  status: "completed",
});
const [electricalForm] = await db
  .insert(formTemplates)
  .values({
    entityId: ADEL_ENTITY_ID,
    brandId: adel.id,
    name: "Electrical closeout",
    items: [
      { id: "breakers", label: "Breaker directory labeled", required: true },
      { id: "cover", label: "Panel cover secured", required: true },
      { id: "gfci", label: "GFCI devices tested", required: true },
      { id: "clean", label: "Work area cleaned", required: true },
      { id: "walk", label: "Customer walked through what changed", required: false },
    ],
  })
  .returning();
const [marcoVisit] = await db
  .insert(visits)
  .values({
    entityId: ADEL_ENTITY_ID,
    jobId: anyaJob.id,
    technicianId: marco.id,
    scheduledStart: zonedDateTime(today, "08:30", timeZone),
    scheduledEnd: zonedDateTime(today, "11:30", timeZone),
    status: "en_route",
  })
  .returning();
await db.insert(visitForms).values({
  visitId: marcoVisit.id,
  templateId: electricalForm.id,
  name: electricalForm.name,
  items: electricalForm.items,
  responses: electricalForm.items.map((item) => ({ itemId: item.id, checked: false, note: "" })),
});
await db.insert(visitNotes).values({
  visitId: marcoVisit.id,
  authorId: renee.id,
  body: "Meter is on the north wall. Anya asked us to keep the carport clear by 3.",
});

const marcoSecret = newSecret("adeldev_");
const sofiaSecret = newSecret("adeldev_");
const [marcoDevice] = await db
  .insert(deviceTokens)
  .values({
    userId: marco.id,
    name: "Marco company phone",
    tokenHash: hashSecret(marcoSecret),
    tokenPrefix: marcoSecret.slice(0, 16),
    acknowledgedAt: new Date(),
  })
  .returning();
await db
  .insert(deviceTokens)
  .values({
    userId: sofia.id,
    name: "Sofia company phone",
    tokenHash: hashSecret(sofiaSecret),
    tokenPrefix: sofiaSecret.slice(0, 16),
    acknowledgedAt: new Date(),
  });
const now = Date.now();
await db.insert(locationPoints).values([
  { userId: marco.id, deviceTokenId: marcoDevice.id, recordedAt: new Date(now - 28 * 60 * 1000), latitude: 25.9, longitude: -80.31, accuracyMeters: 18, batteryPercent: 74 },
  { userId: marco.id, deviceTokenId: marcoDevice.id, recordedAt: new Date(now - 20 * 60 * 1000), latitude: 25.86, longitude: -80.29, accuracyMeters: 14, batteryPercent: 72 },
  { userId: marco.id, deviceTokenId: marcoDevice.id, recordedAt: new Date(now - 12 * 60 * 1000), latitude: 25.82, longitude: -80.27, accuracyMeters: 12, batteryPercent: 70 },
  { userId: marco.id, deviceTokenId: marcoDevice.id, recordedAt: new Date(now - 4 * 60 * 1000), latitude: 25.79, longitude: -80.262, accuracyMeters: 9, batteryPercent: 68 },
]);

await db.insert(visits).values({
  entityId: ADEL_ENTITY_ID,
  jobId: marcusJob.id,
  technicianId: marco.id,
  scheduledStart: zonedDateTime("2026-10-02", "09:00", timeZone),
  scheduledEnd: zonedDateTime("2026-10-02", "15:00", timeZone),
  status: "completed",
  completedAt: zonedDateTime("2026-10-02", "14:40", timeZone),
  signedByName: "Marcus Bell",
  signedAt: zonedDateTime("2026-10-02", "14:40", timeZone),
});

const [marcusInvoice] = await db
  .insert(invoices)
  .values({
    entityId: ADEL_ENTITY_ID,
    number: 1001,
    jobId: marcusJob.id,
    customerId: marcus.customer.id,
    brandId: adel.id,
    status: "issued",
    taxRateBps: 700,
    issuedAt: new Date("2026-10-03T15:00:00.000Z"),
    dueAt: new Date("2026-10-18T15:00:00.000Z"),
    notes: "Thank you. Please reference the invoice number on the check.",
  })
  .returning();
await db.insert(invoiceLineItems).values([
  { invoiceId: marcusInvoice.id, position: 0, kind: "labor", description: "Landscape lighting labor", quantity: "8.00", unitAmountCents: 12500, taxable: false },
  { invoiceId: marcusInvoice.id, position: 1, kind: "material", description: "Fixtures, transformer, and cable", quantity: "1.00", unitAmountCents: 186000, taxable: true },
]);

await db.insert(counters).values([
  { entityId: ADEL_ENTITY_ID, name: "quote", value: 1003 },
  { entityId: ADEL_ENTITY_ID, name: "job", value: 1002 },
  { entityId: ADEL_ENTITY_ID, name: "invoice", value: 1001 },
  { entityId: SERVICE_ENTITY_ID, name: "job", value: 1001 },
]);

const [palmCourt] = await db
  .insert(customers)
  .values({
    entityId: SERVICE_ENTITY_ID,
    brandId: SERVICE_BRAND_ID,
    name: "Palm Court HOA",
    email: "board@palmcourt.example",
    phone: "239-555-0160",
    notes: "Quarterly lighting check on the service contract. Adel Electric supplies the technician.",
  })
  .returning();
const [palmProperty] = await db
  .insert(properties)
  .values({
    entityId: SERVICE_ENTITY_ID,
    customerId: palmCourt.id,
    label: "Clubhouse",
    line1: "900 Palm Court Dr",
    city: "Naples",
    state: "FL",
    postalCode: "34108",
    accessNotes: "Check in at the guardhouse. Panel is in the clubhouse electrical room.",
    latitude: 26.271,
    longitude: -81.801,
  })
  .returning();
const [palmJob] = await db
  .insert(jobs)
  .values({
    entityId: SERVICE_ENTITY_ID,
    number: 1001,
    customerId: palmCourt.id,
    propertyId: palmProperty.id,
    brandId: SERVICE_BRAND_ID,
    title: "Quarterly lighting check",
    status: "scheduled",
    instructions: "Marco is on Adel Electric's payroll. Charge his time back to Service Contracts.",
  })
  .returning();
await db.insert(visits).values({
  entityId: SERVICE_ENTITY_ID,
  jobId: palmJob.id,
  technicianId: marco.id,
  scheduledStart: zonedDateTime(today, "09:00", timeZone),
  scheduledEnd: zonedDateTime(today, "11:00", timeZone),
  status: "scheduled",
});

await db.insert(catalogItems).values([
  { entityId: ADEL_ENTITY_ID, name: "LED driver", kind: "material", unitAmountCents: 4200, taxable: true, description: "Constant-current driver" },
  { entityId: ADEL_ENTITY_ID, name: "Labor", kind: "labor", unitAmountCents: 12500, taxable: false, description: "Field labor" },
  { entityId: SERVICE_ENTITY_ID, name: "Contract visit", kind: "labor", unitAmountCents: 0, taxable: false, description: "Included service-contract visit" },
]);

await db.insert(intercompanyRates).values([
  {
    supplyingEntityId: ADEL_ENTITY_ID,
    consumingEntityId: SERVICE_ENTITY_ID,
    kind: "labor",
    name: "Field technician hour",
    unit: "hour",
    unitAmountCents: 9500,
  },
  {
    supplyingEntityId: ADEL_ENTITY_ID,
    consumingEntityId: SERVICE_ENTITY_ID,
    kind: "material",
    name: "Materials at cost",
    unit: "each",
    unitAmountCents: 0,
  },
]);

const demoSecret = newSecret("adel_");
await db.insert(apiTokens).values({
  entityId: ADEL_ENTITY_ID,
  name: "Local demo",
  tokenHash: hashSecret(demoSecret),
  tokenPrefix: demoSecret.slice(0, 12),
  role: "admin",
  userId: alan.id,
  createdById: alan.id,
});

await db.insert(speechTerms).values(
  [
    "Crestron",
    "Lutron",
    "Casambi",
    "Sonos",
    "UniFi",
    "2N",
    "Control4",
    "Savant",
    "DMX",
    "PoE",
    "GFCI",
    "AFCI",
    "Cat6",
    "HDMI",
    "keypad",
    "touch panel",
    "shade motor",
    "rack",
    "interlock",
    "EV charger",
    "load calculation",
    "panel schedule",
    "low voltage",
    "dimmer",
  ].map((phrase) => ({ phrase, status: "active" as const, createdById: alan.id })),
);

await db.update(requests).set({ updatedAt: new Date() }).where(eq(requests.id, panelRequest.id));

console.log("Seeded Adel Service.");
console.log("Demo password for every login: Fieldnote-demo-2026");
console.log("  alan@adel.example             admin");
console.log("  renee.okonkwo@adel.example    office");
console.log("  marco.vell@adel.example       tech");
console.log("  sofia.brennan@adel.example    tech");
console.log(`Demo admin API token (also used by the MCP server): ${demoSecret}`);
console.log(`Helen Cho estimate link: /q/${helenQuote.publicToken}`);

await sql.end();
