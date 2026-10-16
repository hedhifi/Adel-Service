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
const { db, sql } = await import("./client");
const schema = await import("./schema");

const {
  apiTokens,
  brands,
  companySettings,
  counters,
  customers,
  formTemplates,
  invoiceLineItems,
  invoices,
  jobs,
  payments,
  properties,
  quoteLineItems,
  quotes,
  requests,
  timeEntries,
  users,
  visitForms,
  speechTerms,
  visitNotes,
  visits,
} = schema;

const existing = await db.select({ id: users.id }).from(users).limit(1);
if (existing.length && process.env.SEED_RESET !== "yes") {
  console.log("Database already has users. Set SEED_RESET=yes to wipe and reseed.");
  await sql.end();
  process.exit(0);
}
if (existing.length) await truncateAll();

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

const [adel] = await db.insert(brands).values({ name: "Adel Electric", slug: "adel-electric" }).returning();
const [hed] = await db.insert(brands).values({ name: "HED", slug: "hed" }).returning();

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

async function addCustomer(input: {
  brandId: string;
  name: string;
  email: string;
  phone: string;
  notes: string;
  property: { label: string; line1: string; city: string; postalCode: string; accessNotes: string };
}) {
  const [customer] = await db
    .insert(customers)
    .values({
      brandId: input.brandId,
      name: input.name,
      email: input.email,
      phone: input.phone,
      notes: input.notes,
    })
    .returning();
  const [property] = await db
    .insert(properties)
    .values({ customerId: customer.id, state: "FL", ...input.property })
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
  },
});

const iyer = await addCustomer({
  brandId: hed.id,
  name: "Rohan and Meera Iyer",
  email: "meera.iyer@example.net",
  phone: "813-555-2160",
  notes: "HED theater and shade package. They travel on weekends.",
  property: {
    label: "Bayshore residence",
    line1: "1200 S Ocean Blvd",
    city: "Tampa",
    postalCode: "33606",
    accessNotes: "Rack is in the upstairs closet. House manager Luis can let you in after 12.",
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
  },
});

const lila = await addCustomer({
  brandId: hed.id,
  name: "Lila Navarro",
  email: "lila.navarro@example.net",
  phone: "954-555-2133",
  notes: "Rack cleanup after a remodel. Paid by check.",
  property: {
    label: "Las Olas condo",
    line1: "900 E Las Olas Blvd",
    city: "Fort Lauderdale",
    postalCode: "33301",
    accessNotes: "Concierge has the service elevator code. Unit 1402.",
  },
});

const [panelRequest] = await db
  .insert(requests)
  .values({
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

const lilaQuote = await addApprovedQuote({
  number: 1004,
  customerId: lila.customer.id,
  propertyId: lila.property.id,
  brandId: hed.id,
  title: "Rack cleanup",
  notes: "Re-dress the rack, label both ends, and confirm the Apple TV and shades processor.",
  approvedByName: "Lila Navarro",
  lines: [
    { kind: "labor", description: "Rack service", quantity: "3.00", unitAmountCents: 16500, taxable: false },
    { kind: "material", description: "Velcro, labels, and patch cables", quantity: "1.00", unitAmountCents: 8500, taxable: true },
  ],
});

const iyerQuote = await addApprovedQuote({
  number: 1005,
  customerId: iyer.customer.id,
  propertyId: iyer.property.id,
  brandId: hed.id,
  title: "Theater commissioning and shades",
  notes: "Finish programming the theater and bring the shade gateway back online.",
  approvedByName: "Meera Iyer",
  lines: [
    { kind: "labor", description: "Commissioning visit", quantity: "4.00", unitAmountCents: 18500, taxable: false },
    { kind: "material", description: "Shade gateway replacement", quantity: "1.00", unitAmountCents: 42000, taxable: true },
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
  const [job] = await db.insert(jobs).values(input).returning();
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
const iyerJob = await addJob({
  number: 1002,
  quoteId: iyerQuote.id,
  customerId: iyer.customer.id,
  propertyId: iyer.property.id,
  brandId: hed.id,
  title: iyerQuote.title,
  instructions: "Shade gateway was offline last visit. Bring a spare. Don't leave the rack fan unplugged.",
  status: "in_progress",
});
const marcusJob = await addJob({
  number: 1003,
  quoteId: marcusQuote.id,
  customerId: marcus.customer.id,
  propertyId: marcus.property.id,
  brandId: adel.id,
  title: marcusQuote.title,
  instructions: "Customer wants the path lights at 2700K. Photo the transformer nameplate.",
  status: "completed",
});
const lilaJob = await addJob({
  number: 1004,
  quoteId: lilaQuote.id,
  customerId: lila.customer.id,
  propertyId: lila.property.id,
  brandId: hed.id,
  title: lilaQuote.title,
  instructions: "Concierge will escort you up.",
  status: "completed",
});

const [electricalForm] = await db
  .insert(formTemplates)
  .values({
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
const [avForm] = await db
  .insert(formTemplates)
  .values({
    brandId: hed.id,
    name: "AV commissioning",
    items: [
      { id: "displays", label: "Displays power on and switch sources", required: true },
      { id: "zones", label: "Audio zones labeled in the control app", required: true },
      { id: "temp", label: "Rack temperatures in a normal range", required: true },
      { id: "network", label: "Network gear documented", required: false },
      { id: "shown", label: "Customer shown how to start the room", required: false },
    ],
  })
  .returning();

const [marcoVisit] = await db
  .insert(visits)
  .values({
    jobId: anyaJob.id,
    technicianId: marco.id,
    scheduledStart: zonedDateTime(today, "08:30", timeZone),
    scheduledEnd: zonedDateTime(today, "11:30", timeZone),
    status: "scheduled",
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

const [sofiaVisit] = await db
  .insert(visits)
  .values({
    jobId: iyerJob.id,
    technicianId: sofia.id,
    scheduledStart: zonedDateTime(today, "13:00", timeZone),
    scheduledEnd: zonedDateTime(today, "16:30", timeZone),
    status: "on_site",
  })
  .returning();
await db.insert(visitForms).values({
  visitId: sofiaVisit.id,
  templateId: avForm.id,
  name: avForm.name,
  items: avForm.items,
  responses: avForm.items.map((item) => ({
    itemId: item.id,
    checked: item.id === "displays",
    note: item.id === "displays" ? "Both displays came up on the Apple TV." : "",
  })),
});
await db.insert(visitNotes).values({
  visitId: sofiaVisit.id,
  authorId: sofia.id,
  body: "Shade gateway was offline at arrival. Spare is on the truck.",
});
await db.insert(timeEntries).values({
  visitId: sofiaVisit.id,
  userId: sofia.id,
  startedAt: zonedDateTime(today, "13:05", timeZone),
});

await db.insert(visits).values({
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

const [lilaInvoice] = await db
  .insert(invoices)
  .values({
    number: 1002,
    jobId: lilaJob.id,
    customerId: lila.customer.id,
    brandId: hed.id,
    status: "paid",
    taxRateBps: 700,
    issuedAt: new Date("2026-09-18T15:00:00.000Z"),
    dueAt: new Date("2026-10-03T15:00:00.000Z"),
  })
  .returning();
await db.insert(invoiceLineItems).values([
  { invoiceId: lilaInvoice.id, position: 0, kind: "labor", description: "Rack service", quantity: "3.00", unitAmountCents: 16500, taxable: false },
  { invoiceId: lilaInvoice.id, position: 1, kind: "material", description: "Velcro, labels, and patch cables", quantity: "1.00", unitAmountCents: 8500, taxable: true },
]);
await db.insert(payments).values({
  invoiceId: lilaInvoice.id,
  amountCents: 58595,
  status: "succeeded",
  method: "check",
  reference: "1044",
  recordedById: renee.id,
  receivedAt: new Date("2026-09-20T18:00:00.000Z"),
});

await db.insert(counters).values([
  { name: "quote", value: 1005 },
  { name: "job", value: 1004 },
  { name: "invoice", value: 1002 },
]);

const demoSecret = newSecret("adel_");
await db.insert(apiTokens).values({
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
