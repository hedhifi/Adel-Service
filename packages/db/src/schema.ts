import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
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
export const speechTermStatus = pgEnum("speech_term_status", ["active", "suggested"]);
export const geofenceKind = pgEnum("geofence_kind", ["arrive", "depart"]);

export type Role = (typeof userRole.enumValues)[number];
export type RequestStatus = (typeof requestStatus.enumValues)[number];
export type QuoteStatus = (typeof quoteStatus.enumValues)[number];
export type JobStatus = (typeof jobStatus.enumValues)[number];
export type VisitStatus = (typeof visitStatus.enumValues)[number];
export type InvoiceStatus = (typeof invoiceStatus.enumValues)[number];
export type PaymentMethod = (typeof paymentMethod.enumValues)[number];
export type LineKind = (typeof lineKind.enumValues)[number];

export type FormItem = { id: string; label: string; required: boolean };
export type FormResponse = { itemId: string; checked: boolean; note: string; rawNote?: string };

/**
 * Adel Electric and Service Contracts share this database. Each business row
 * belongs to one entity. A brand is the name that entity prints on its estimates.
 */
export const entities = pgTable("entities", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  taxRateBps: integer("tax_rate_bps").notNull().default(700),
  taxLabel: text("tax_label").notNull().default("Estimated Florida sales tax"),
  stripeAccountId: text("stripe_account_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const brands = pgTable(
  "brands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("brands_entity_slug_unique").on(table.entityId, table.slug)],
);

export const companySettings = pgTable("company_settings", {
  id: text("id").primaryKey().default("default"),
  legalName: text("legal_name").notNull(),
  timeZone: text("time_zone").notNull().default("America/New_York"),
  defaultTaxRateBps: integer("default_tax_rate_bps").notNull().default(700),
  taxLabel: text("tax_label").notNull(),
  requireSignatureToComplete: boolean("require_signature_to_complete").notNull().default(true),
  shopAddress: text("shop_address").notNull(),
  trackingStart: text("tracking_start").notNull().default("07:00"),
  trackingEnd: text("tracking_end").notNull().default("18:00"),
  locationRetentionDays: integer("location_retention_days").notNull().default(14),
  reportRemindersEnabled: boolean("report_reminders_enabled").notNull().default(true),
  reportReminderGraceSeconds: integer("report_reminder_grace_seconds").notNull().default(120),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: userRole("role").notNull(),
  phone: text("phone"),
  dictationLanguage: text("dictation_language").notNull().default("en"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const entityMemberships = pgTable(
  "entity_memberships",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    role: userRole("role").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.entityId] })],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    activeEntityId: uuid("active_entity_id")
      .notNull()
      .references(() => entities.id),
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
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id),
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
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id),
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
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("properties_customer_idx").on(table.customerId)],
);

export const requests = pgTable(
  "requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id),
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
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id),
    number: integer("number").notNull(),
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
  (table) => [index("quotes_status_idx").on(table.status), unique("quotes_entity_number_unique").on(table.entityId, table.number)],
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
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id),
    number: integer("number").notNull(),
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
  (table) => [index("jobs_status_idx").on(table.status), unique("jobs_entity_number_unique").on(table.entityId, table.number)],
);

export const visits = pgTable(
  "visits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id),
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
    signedByRaw: text("signed_by_raw"),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    reportRemindedAt: timestamp("report_reminded_at", { withTimezone: true }),
    reportReminderDueAt: timestamp("report_reminder_due_at", { withTimezone: true }),
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
  rawBody: text("raw_body"),
  sourceLanguage: text("source_language"),
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
  rawCaption: text("raw_caption"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const formTemplates = pgTable("form_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  entityId: uuid("entity_id")
    .notNull()
    .references(() => entities.id),
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
  rawNote: text("raw_note"),
});

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id),
    number: integer("number").notNull(),
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
  (table) => [
    index("invoices_status_idx").on(table.status),
    index("invoices_job_idx").on(table.jobId),
    unique("invoices_entity_number_unique").on(table.entityId, table.number),
  ],
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
  entityId: uuid("entity_id")
    .notNull()
    .references(() => entities.id),
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
  entityId: uuid("entity_id")
    .notNull()
    .references(() => entities.id),
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

export const speechTerms = pgTable(
  "speech_terms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    phrase: text("phrase").notNull(),
    status: speechTermStatus("status").notNull().default("active"),
    createdById: uuid("created_by_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("speech_terms_status_idx").on(table.status)],
);

export const deviceTokens = pgTable(
  "device_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    tokenPrefix: text("token_prefix").notNull(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("device_tokens_user_idx").on(table.userId)],
);

export const locationPoints = pgTable(
  "location_points",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceTokenId: uuid("device_token_id")
      .notNull()
      .references(() => deviceTokens.id, { onDelete: "cascade" }),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    accuracyMeters: doublePrecision("accuracy_meters").notNull(),
    batteryPercent: integer("battery_percent").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("location_points_user_time_idx").on(table.userId, table.recordedAt)],
);

export const geofenceEvents = pgTable(
  "geofence_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    visitId: uuid("visit_id")
      .notNull()
      .references(() => visits.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    kind: geofenceKind("kind").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
  },
  (table) => [index("geofence_events_visit_idx").on(table.visitId, table.recordedAt)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    visitId: uuid("visit_id").references(() => visits.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    href: text("href").notNull(),
    pushStatus: text("push_status").notNull().default("unavailable"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (table) => [index("notifications_user_idx").on(table.userId, table.createdAt)],
);

export const counters = pgTable(
  "counters",
  {
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id),
    name: text("name").notNull(),
    value: integer("value").notNull(),
  },
  (table) => [primaryKey({ columns: [table.entityId, table.name] })],
);

export const contractStatus = pgEnum("contract_status", ["draft", "active", "ended"]);

export const contracts = pgTable(
  "contracts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on"),
    status: contractStatus("status").notNull().default("draft"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("contracts_entity_idx").on(table.entityId)],
);

/**
 * The only cross-entity reference. Record ids are not foreign keys, so either
 * entity can be exported without the other.
 */
export const entityLinks = pgTable(
  "entity_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    fromEntityId: uuid("from_entity_id")
      .notNull()
      .references(() => entities.id),
    fromRecordId: uuid("from_record_id").notNull(),
    toEntityId: uuid("to_entity_id")
      .notNull()
      .references(() => entities.id),
    toRecordId: uuid("to_record_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("entity_links_from_idx").on(table.fromEntityId), index("entity_links_to_idx").on(table.toEntityId)],
);
