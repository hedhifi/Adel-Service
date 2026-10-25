CREATE TYPE "user_role" AS ENUM('admin', 'office', 'tech');
--> statement-breakpoint
CREATE TYPE "request_status" AS ENUM('new', 'reviewing', 'quoted', 'closed', 'canceled');
--> statement-breakpoint
CREATE TYPE "quote_status" AS ENUM('draft', 'sent', 'approved', 'declined', 'expired');
--> statement-breakpoint
CREATE TYPE "job_status" AS ENUM('unscheduled', 'scheduled', 'in_progress', 'completed', 'canceled');
--> statement-breakpoint
CREATE TYPE "visit_status" AS ENUM('scheduled', 'en_route', 'on_site', 'completed', 'canceled');
--> statement-breakpoint
CREATE TYPE "invoice_status" AS ENUM('draft', 'issued', 'partial', 'paid', 'void');
--> statement-breakpoint
CREATE TYPE "payment_status" AS ENUM('processing', 'succeeded', 'failed', 'canceled');
--> statement-breakpoint
CREATE TYPE "payment_method" AS ENUM('card', 'check', 'cash', 'other');
--> statement-breakpoint
CREATE TYPE "line_kind" AS ENUM('labor', 'material', 'other');
--> statement-breakpoint
CREATE TYPE "webhook_delivery_status" AS ENUM('pending', 'delivered', 'failed');
--> statement-breakpoint
CREATE TABLE "brands" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "brands_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "company_settings" (
  "id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
  "legal_name" text NOT NULL,
  "time_zone" text DEFAULT 'America/New_York' NOT NULL,
  "default_tax_rate_bps" integer DEFAULT 700 NOT NULL,
  "tax_label" text NOT NULL,
  "require_signature_to_complete" boolean DEFAULT true NOT NULL,
  "shop_address" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" text NOT NULL,
  "name" text NOT NULL,
  "password_hash" text NOT NULL,
  "role" "user_role" NOT NULL,
  "phone" text,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "token_hash" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "customers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "brand_id" uuid NOT NULL,
  "name" text NOT NULL,
  "email" text,
  "phone" text,
  "notes" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "properties" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "customer_id" uuid NOT NULL,
  "label" text NOT NULL,
  "line1" text NOT NULL,
  "line2" text,
  "city" text NOT NULL,
  "state" text DEFAULT 'FL' NOT NULL,
  "postal_code" text NOT NULL,
  "access_notes" text,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "customer_id" uuid NOT NULL,
  "property_id" uuid NOT NULL,
  "brand_id" uuid NOT NULL,
  "title" text NOT NULL,
  "description" text NOT NULL,
  "status" "request_status" DEFAULT 'new' NOT NULL,
  "source" text DEFAULT 'phone' NOT NULL,
  "created_by_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "number" integer NOT NULL,
  "customer_id" uuid NOT NULL,
  "property_id" uuid NOT NULL,
  "request_id" uuid,
  "brand_id" uuid NOT NULL,
  "title" text NOT NULL,
  "status" "quote_status" DEFAULT 'draft' NOT NULL,
  "tax_rate_bps" integer NOT NULL,
  "notes" text,
  "public_token" text,
  "valid_until" timestamptz,
  "sent_at" timestamptz,
  "approved_at" timestamptz,
  "approved_by_name" text,
  "declined_at" timestamptz,
  "decline_reason" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "quotes_number_unique" UNIQUE("number"),
  CONSTRAINT "quotes_public_token_unique" UNIQUE("public_token")
);
--> statement-breakpoint
CREATE TABLE "quote_line_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "quote_id" uuid NOT NULL,
  "position" integer NOT NULL,
  "kind" "line_kind" DEFAULT 'other' NOT NULL,
  "description" text NOT NULL,
  "quantity" numeric(10, 2) NOT NULL,
  "unit_amount_cents" integer NOT NULL,
  "taxable" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "number" integer NOT NULL,
  "customer_id" uuid NOT NULL,
  "property_id" uuid NOT NULL,
  "quote_id" uuid,
  "brand_id" uuid NOT NULL,
  "title" text NOT NULL,
  "status" "job_status" DEFAULT 'unscheduled' NOT NULL,
  "instructions" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "jobs_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "visits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "job_id" uuid NOT NULL,
  "technician_id" uuid,
  "scheduled_start" timestamptz NOT NULL,
  "scheduled_end" timestamptz NOT NULL,
  "status" "visit_status" DEFAULT 'scheduled' NOT NULL,
  "internal_notes" text,
  "signature_png" text,
  "signed_by_name" text,
  "signed_at" timestamptz,
  "completed_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visit_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "visit_id" uuid NOT NULL,
  "author_id" uuid NOT NULL,
  "body" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visit_photos" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "visit_id" uuid NOT NULL,
  "author_id" uuid NOT NULL,
  "storage_key" text NOT NULL,
  "content_type" text NOT NULL,
  "caption" text,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "brand_id" uuid,
  "name" text NOT NULL,
  "items" jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visit_forms" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "visit_id" uuid NOT NULL,
  "template_id" uuid,
  "name" text NOT NULL,
  "items" jsonb NOT NULL,
  "responses" jsonb NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "visit_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "started_at" timestamptz NOT NULL,
  "ended_at" timestamptz,
  "note" text
);
--> statement-breakpoint
CREATE TABLE "invoices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "number" integer NOT NULL,
  "job_id" uuid,
  "customer_id" uuid NOT NULL,
  "brand_id" uuid NOT NULL,
  "status" "invoice_status" DEFAULT 'draft' NOT NULL,
  "tax_rate_bps" integer NOT NULL,
  "issued_at" timestamptz,
  "due_at" timestamptz,
  "notes" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "invoices_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "invoice_line_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "invoice_id" uuid NOT NULL,
  "position" integer NOT NULL,
  "kind" "line_kind" DEFAULT 'other' NOT NULL,
  "description" text NOT NULL,
  "quantity" numeric(10, 2) NOT NULL,
  "unit_amount_cents" integer NOT NULL,
  "taxable" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "invoice_id" uuid NOT NULL,
  "amount_cents" integer NOT NULL,
  "status" "payment_status" NOT NULL,
  "method" "payment_method" NOT NULL,
  "stripe_payment_intent_id" text,
  "reference" text,
  "recorded_by_id" uuid,
  "received_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "token_hash" text NOT NULL,
  "token_prefix" text NOT NULL,
  "role" "user_role" NOT NULL,
  "user_id" uuid,
  "created_by_id" uuid,
  "revoked_at" timestamptz,
  "last_used_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "api_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "url" text NOT NULL,
  "secret" text NOT NULL,
  "events" text[] NOT NULL,
  "description" text,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "endpoint_id" uuid NOT NULL,
  "event" text NOT NULL,
  "payload" jsonb NOT NULL,
  "status" "webhook_delivery_status" DEFAULT 'pending' NOT NULL,
  "response_code" integer,
  "response_body" text,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "delivered_at" timestamptz
);
--> statement-breakpoint
CREATE TABLE "counters" (
  "name" text PRIMARY KEY NOT NULL,
  "value" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quote_line_items" ADD CONSTRAINT "quote_line_items_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_technician_id_users_id_fk" FOREIGN KEY ("technician_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "visit_notes" ADD CONSTRAINT "visit_notes_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "visit_notes" ADD CONSTRAINT "visit_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "visit_photos" ADD CONSTRAINT "visit_photos_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "visit_photos" ADD CONSTRAINT "visit_photos_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "form_templates" ADD CONSTRAINT "form_templates_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "visit_forms" ADD CONSTRAINT "visit_forms_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "visit_forms" ADD CONSTRAINT "visit_forms_template_id_form_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."form_templates"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "customers_name_idx" ON "customers" USING btree ("name");
--> statement-breakpoint
CREATE INDEX "customers_brand_idx" ON "customers" USING btree ("brand_id");
--> statement-breakpoint
CREATE INDEX "properties_customer_idx" ON "properties" USING btree ("customer_id");
--> statement-breakpoint
CREATE INDEX "requests_status_idx" ON "requests" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "quotes_status_idx" ON "quotes" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "quote_lines_quote_idx" ON "quote_line_items" USING btree ("quote_id");
--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "jobs" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "visits_job_idx" ON "visits" USING btree ("job_id");
--> statement-breakpoint
CREATE INDEX "visits_tech_start_idx" ON "visits" USING btree ("technician_id","scheduled_start");
--> statement-breakpoint
CREATE INDEX "invoices_status_idx" ON "invoices" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "invoices_job_idx" ON "invoices" USING btree ("job_id");
--> statement-breakpoint
CREATE INDEX "invoice_lines_invoice_idx" ON "invoice_line_items" USING btree ("invoice_id");
--> statement-breakpoint
CREATE INDEX "payments_invoice_idx" ON "payments" USING btree ("invoice_id");
--> statement-breakpoint
CREATE INDEX "webhook_deliveries_status_idx" ON "webhook_deliveries" USING btree ("status");
