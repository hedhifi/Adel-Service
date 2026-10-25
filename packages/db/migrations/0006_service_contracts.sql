ALTER TYPE "contract_status" ADD VALUE IF NOT EXISTS 'lapsed';
--> statement-breakpoint
ALTER TYPE "contract_status" ADD VALUE IF NOT EXISTS 'canceled';
--> statement-breakpoint
CREATE TYPE "billing_frequency" AS ENUM('monthly', 'quarterly', 'annual', 'custom');
--> statement-breakpoint
CREATE TYPE "schedule_frequency" AS ENUM('monthly', 'quarterly', 'annual', 'custom');
--> statement-breakpoint
CREATE TYPE "schedule_interval_unit" AS ENUM('day', 'week', 'month');
--> statement-breakpoint
CREATE TYPE "occurrence_status" AS ENUM('scheduled', 'skipped', 'shifted');
--> statement-breakpoint
CREATE TYPE "renewal_source" AS ENUM('manual', 'auto');
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "job_id" uuid;
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "title" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "price_cents" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "billing_frequency" "billing_frequency" DEFAULT 'annual' NOT NULL;
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "billing_interval_count" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "scope" text;
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "auto_renew" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "renewal_term_months" integer DEFAULT 12 NOT NULL;
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "reminder_days" integer DEFAULT 30 NOT NULL;
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "next_bill_on" date;
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "stripe_customer_id" text;
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "canceled_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "lapsed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "contract_id" uuid;
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "invoices_contract_idx" ON "invoices" USING btree ("contract_id");
--> statement-breakpoint
CREATE TABLE "contract_properties" (
  "contract_id" uuid NOT NULL,
  "property_id" uuid NOT NULL,
  "entity_id" uuid NOT NULL,
  CONSTRAINT "contract_properties_contract_id_property_id_pk" PRIMARY KEY("contract_id","property_id")
);
--> statement-breakpoint
ALTER TABLE "contract_properties" ADD CONSTRAINT "contract_properties_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "contract_properties" ADD CONSTRAINT "contract_properties_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "contract_properties" ADD CONSTRAINT "contract_properties_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "contract_properties_entity_idx" ON "contract_properties" USING btree ("entity_id");
--> statement-breakpoint
INSERT INTO "contract_properties" ("contract_id", "property_id", "entity_id")
SELECT "id", "property_id", "entity_id" FROM "contracts"
ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE TABLE "contract_equipment" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "entity_id" uuid NOT NULL,
  "contract_id" uuid NOT NULL,
  "property_id" uuid,
  "name" text NOT NULL,
  "location" text,
  "serial" text,
  "notes" text
);
--> statement-breakpoint
ALTER TABLE "contract_equipment" ADD CONSTRAINT "contract_equipment_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "contract_equipment" ADD CONSTRAINT "contract_equipment_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "contract_equipment" ADD CONSTRAINT "contract_equipment_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "contract_equipment_contract_idx" ON "contract_equipment" USING btree ("contract_id");
--> statement-breakpoint
CREATE INDEX "contract_equipment_entity_idx" ON "contract_equipment" USING btree ("entity_id");
--> statement-breakpoint
CREATE TABLE "contract_schedules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "entity_id" uuid NOT NULL,
  "contract_id" uuid NOT NULL,
  "frequency" "schedule_frequency" NOT NULL,
  "interval_count" integer DEFAULT 1 NOT NULL,
  "interval_unit" "schedule_interval_unit" DEFAULT 'month' NOT NULL,
  "anchor_on" date NOT NULL,
  "local_start" text DEFAULT '09:00' NOT NULL,
  "duration_minutes" integer DEFAULT 60 NOT NULL,
  "technician_id" uuid,
  "horizon_days" integer DEFAULT 90 NOT NULL,
  "title" text NOT NULL,
  "instructions" text,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contract_schedules" ADD CONSTRAINT "contract_schedules_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "contract_schedules" ADD CONSTRAINT "contract_schedules_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "contract_schedules" ADD CONSTRAINT "contract_schedules_technician_id_users_id_fk" FOREIGN KEY ("technician_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "contract_schedules_contract_idx" ON "contract_schedules" USING btree ("contract_id");
--> statement-breakpoint
CREATE INDEX "contract_schedules_entity_idx" ON "contract_schedules" USING btree ("entity_id");
--> statement-breakpoint
CREATE TABLE "schedule_occurrences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "entity_id" uuid NOT NULL,
  "schedule_id" uuid NOT NULL,
  "original_on" date NOT NULL,
  "occurs_on" date NOT NULL,
  "visit_id" uuid,
  "status" "occurrence_status" DEFAULT 'scheduled' NOT NULL,
  "skip_reason" text,
  "pinned" boolean DEFAULT false NOT NULL,
  "generated_start" timestamp with time zone,
  "generated_end" timestamp with time zone,
  "generated_technician_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "schedule_occurrences_date_unique" UNIQUE("schedule_id","original_on")
);
--> statement-breakpoint
ALTER TABLE "schedule_occurrences" ADD CONSTRAINT "schedule_occurrences_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "schedule_occurrences" ADD CONSTRAINT "schedule_occurrences_schedule_id_contract_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."contract_schedules"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "schedule_occurrences" ADD CONSTRAINT "schedule_occurrences_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "schedule_occurrences_schedule_idx" ON "schedule_occurrences" USING btree ("schedule_id");
--> statement-breakpoint
CREATE INDEX "schedule_occurrences_entity_idx" ON "schedule_occurrences" USING btree ("entity_id");
--> statement-breakpoint
CREATE TABLE "contract_charges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "entity_id" uuid NOT NULL,
  "contract_id" uuid NOT NULL,
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "amount_cents" integer NOT NULL,
  "invoice_id" uuid,
  "stripe_invoice_id" text,
  "stripe_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "contract_charges_period_unique" UNIQUE("contract_id","period_start")
);
--> statement-breakpoint
ALTER TABLE "contract_charges" ADD CONSTRAINT "contract_charges_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "contract_charges" ADD CONSTRAINT "contract_charges_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "contract_charges" ADD CONSTRAINT "contract_charges_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "contract_charges_entity_idx" ON "contract_charges" USING btree ("entity_id");
--> statement-breakpoint
CREATE TABLE "contract_renewals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "entity_id" uuid NOT NULL,
  "contract_id" uuid NOT NULL,
  "previous_ends_on" date,
  "new_ends_on" date NOT NULL,
  "previous_price_cents" integer NOT NULL,
  "new_price_cents" integer NOT NULL,
  "source" "renewal_source" NOT NULL,
  "renewed_by_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contract_renewals" ADD CONSTRAINT "contract_renewals_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "contract_renewals" ADD CONSTRAINT "contract_renewals_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "contract_renewals" ADD CONSTRAINT "contract_renewals_renewed_by_id_users_id_fk" FOREIGN KEY ("renewed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "contract_renewals_contract_idx" ON "contract_renewals" USING btree ("contract_id");
--> statement-breakpoint
CREATE INDEX "contract_renewals_entity_idx" ON "contract_renewals" USING btree ("entity_id");
--> statement-breakpoint
CREATE TABLE "contract_reminders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "entity_id" uuid NOT NULL,
  "contract_id" uuid NOT NULL,
  "ends_on" date NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "contract_reminders_term_unique" UNIQUE("contract_id","ends_on")
);
--> statement-breakpoint
ALTER TABLE "contract_reminders" ADD CONSTRAINT "contract_reminders_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "contract_reminders" ADD CONSTRAINT "contract_reminders_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "contract_reminders_entity_idx" ON "contract_reminders" USING btree ("entity_id");
