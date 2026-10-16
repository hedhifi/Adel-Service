import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["admin", "office", "tech"]);
export const requestStatus = pgEnum("request_status", ["new", "reviewing", "quoted", "closed", "canceled"]);
export const quoteStatus = pgEnum("quote_status", ["draft", "sent", "approved", "declined", "expired"]);
export const jobStatus = pgEnum("job_status", ["unscheduled", "scheduled", "in_progress", "completed", "canceled"]);
export const visitStatus = pgEnum("visit_status", ["scheduled", "en_route", "on_site", "completed", "canceled"]);
export const invoiceStatus = pgEnum("invoice_status", ["draft", "issued", "partial", "paid", "void"]);
export const paymentStatus = pgEnum("payment_status", ["processing", "succeeded", "failed", "canceled"]);
export const paymentMethod = pgEnum("payment_method", ["card", "check", "cash", "other"]);
export const lineKind = pgEnum("line_kind", ["labor", "material", "other"]);
export const webhookDeliveryStatus = pgEnum("webhook_delivery_status", ["pending", "delivered", "failed"]);

export type Role = (typeof userRole.enumValues)[number];
export type RequestStatus = (typeof requestStatus.enumValues)[number];
export type QuoteStatus = (typeof quoteStatus.enumValues)[number];
export type JobStatus = (typeof jobStatus.enumValues)[number];
export type VisitStatus = (typeof visitStatus.enumValues)[number];
export type InvoiceStatus = (typeof invoiceStatus.enumValues)[number];
export type PaymentMethod = (typeof paymentMethod.enumValues)[number];
export type LineKind = (typeof lineKind.enumValues)[number];

export type FormItem = { id: string; label: string; required: boolean };
export type FormResponse = { itemId: string; checked: boolean; note: string };

/**
 * Adel Electric, LLC is one company. Adel Electric and HED are brands (divisions)
 * on the same customers, jobs, and invoices — not separate tenants.
 */
export const brands = pgTable("brands", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const companySettings = pgTable("company_settings", {
  id: text("id").primaryKey().default("default"),
  legalName: text("legal_name").notNull(),
  timeZone: text("time_zone").notNull().default("America/New_York"),
  defaultTaxRateBps: integer("default_tax_rate_bps").notNull().default(700),
  taxLabel: text("tax_label").notNull(),
  requireSignatureToComplete: boolean("require_signature_to_complete").notNull().default(true),
  shopAddress: text("shop_address").notNull(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: userRole("role").notNull(),
  phone: text("phone"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("sessions_user_idx").on(table.userId)],
);

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("customers_name_idx").on(table.name), index("customers_brand_idx").on(table.brandId)],
);

export const properties = pgTable(
  "properties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    line1: text("line1").notNull(),
    line2: text("line2"),
    city: text("city").notNull(),
    state: text("state").notNull().default("FL"),
    postalCode: text("postal_code").notNull(),
    accessNotes: text("access_notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("properties_customer_idx").on(table.customerId)],
);

export const requests = pgTable(
  "requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id),
    title: text("title").notNull(),
    description: text("description").notNull(),
    status: requestStatus("status").notNull().default("new"),
    source: text("source").notNull().default("phone"),
    createdById: uuid("created_by_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("requests_status_idx").on(table.status)],
);

export const quotes = pgTable(
  "quotes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    number: integer("number").notNull().unique(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id),
    requestId: uuid("request_id").references(() => requests.id),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id),
    title: text("title").notNull(),
    status: quoteStatus("status").notNull().default("draft"),
    taxRateBps: integer("tax_rate_bps").notNull(),
    notes: text("notes"),
    publicToken: text("public_token").unique(),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedByName: text("approved_by_name"),
    declinedAt: timestamp("declined_at", { withTimezone: true }),
    declineReason: text("decline_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("quotes_status_idx").on(table.status)],
);

export const quoteLineItems = pgTable(
  "quote_line_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    kind: lineKind("kind").notNull().default("other"),
    description: text("description").notNull(),
    quantity: numeric("quantity", { precision: 10, scale: 2 }).notNull(),
    unitAmountCents: integer("unit_amount_cents").notNull(),
    taxable: boolean("taxable").notNull().default(false),
  },
  (table) => [index("quote_lines_quote_idx").on(table.quoteId)],
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    number: integer("number").notNull().unique(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id),
    quoteId: uuid("quote_id").references(() => quotes.id),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id),
    title: text("title").notNull(),
    status: jobStatus("status").notNull().default("unscheduled"),
    instructions: text("instructions"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("jobs_status_idx").on(table.status)],
);

export const visits = pgTable(
  "visits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    technicianId: uuid("technician_id").references(() => users.id),
    scheduledStart: timestamp("scheduled_start", { withTimezone: true }).notNull(),
    scheduledEnd: timestamp("scheduled_end", { withTimezone: true }).notNull(),
    status: visitStatus("status").notNull().default("scheduled"),
    internalNotes: text("internal_notes"),
    signaturePng: text("signature_png"),
    signedByName: text("signed_by_name"),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("visits_job_idx").on(table.jobId), index("visits_tech_start_idx").on(table.technicianId, table.scheduledStart)],
);

export const visitNotes = pgTable("visit_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  visitId: uuid("visit_id")
    .notNull()
    .references(() => visits.id, { onDelete: "cascade" }),
  authorId: uuid("author_id")
    .notNull()
    .references(() => users.id),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const visitPhotos = pgTable("visit_photos", {
  id: uuid("id").primaryKey().defaultRandom(),
  visitId: uuid("visit_id")
    .notNull()
    .references(() => visits.id, { onDelete: "cascade" }),
  authorId: uuid("author_id")
    .notNull()
    .references(() => users.id),
  storageKey: text("storage_key").notNull(),
  contentType: text("content_type").notNull(),
  caption: text("caption"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const formTemplates = pgTable("form_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  brandId: uuid("brand_id").references(() => brands.id),
  name: text("name").notNull(),
  items: jsonb("items").$type<FormItem[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const visitForms = pgTable("visit_forms", {
  id: uuid("id").primaryKey().defaultRandom(),
  visitId: uuid("visit_id")
    .notNull()
    .references(() => visits.id, { onDelete: "cascade" }),
  templateId: uuid("template_id").references(() => formTemplates.id),
  name: text("name").notNull(),
  items: jsonb("items").$type<FormItem[]>().notNull(),
  responses: jsonb("responses").$type<FormResponse[]>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const timeEntries = pgTable("time_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  visitId: uuid("visit_id")
    .notNull()
    .references(() => visits.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  note: text("note"),
});

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    number: integer("number").notNull().unique(),
    jobId: uuid("job_id").references(() => jobs.id),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id),
    status: invoiceStatus("status").notNull().default("draft"),
    taxRateBps: integer("tax_rate_bps").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("invoices_status_idx").on(table.status), index("invoices_job_idx").on(table.jobId)],
);

export const invoiceLineItems = pgTable(
  "invoice_line_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    kind: lineKind("kind").notNull().default("other"),
    description: text("description").notNull(),
    quantity: numeric("quantity", { precision: 10, scale: 2 }).notNull(),
    unitAmountCents: integer("unit_amount_cents").notNull(),
    taxable: boolean("taxable").notNull().default(false),
  },
  (table) => [index("invoice_lines_invoice_idx").on(table.invoiceId)],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id),
    amountCents: integer("amount_cents").notNull(),
    status: paymentStatus("status").notNull(),
    method: paymentMethod("method").notNull(),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    reference: text("reference"),
    recordedById: uuid("recorded_by_id").references(() => users.id),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("payments_invoice_idx").on(table.invoiceId)],
);

export const apiTokens = pgTable("api_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  tokenPrefix: text("token_prefix").notNull(),
  role: userRole("role").notNull(),
  userId: uuid("user_id").references(() => users.id),
  createdById: uuid("created_by_id").references(() => users.id),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const webhookEndpoints = pgTable("webhook_endpoints", {
  id: uuid("id").primaryKey().defaultRandom(),
  url: text("url").notNull(),
  secret: text("secret").notNull(),
  events: text("events").array().notNull(),
  description: text("description"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    endpointId: uuid("endpoint_id")
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    payload: jsonb("payload").notNull(),
    status: webhookDeliveryStatus("status").notNull().default("pending"),
    responseCode: integer("response_code"),
    responseBody: text("response_body"),
    attemptCount: integer("attempt_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (table) => [index("webhook_deliveries_status_idx").on(table.status)],
);

export const counters = pgTable("counters", {
  name: text("name").primaryKey(),
  value: integer("value").notNull(),
});
