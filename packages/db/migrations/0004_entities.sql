CREATE TABLE "entities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "tax_rate_bps" integer DEFAULT 700 NOT NULL,
  "tax_label" text DEFAULT 'Estimated Florida sales tax' NOT NULL,
  "stripe_account_id" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "entities_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
INSERT INTO "entities" ("id", "name", "slug", "tax_rate_bps", "tax_label")
VALUES
  ('11111111-1111-4111-8111-111111111111', 'Adel Electric', 'adel-electric', 700, 'Estimated Florida sales tax'),
  ('22222222-2222-4222-8222-222222222222', 'Service Contracts', 'service-contracts', 700, 'Estimated Florida sales tax');
--> statement-breakpoint
UPDATE "entities" AS entity
SET "tax_rate_bps" = settings.default_tax_rate_bps,
    "tax_label" = settings.tax_label
FROM "company_settings" AS settings
WHERE entity.id = '11111111-1111-4111-8111-111111111111'
  AND settings.id = 'default';
--> statement-breakpoint
CREATE TABLE "entity_memberships" (
  "user_id" uuid NOT NULL,
  "entity_id" uuid NOT NULL,
  "role" "user_role" NOT NULL,
  CONSTRAINT "entity_memberships_user_id_entity_id_pk" PRIMARY KEY("user_id","entity_id")
);
--> statement-breakpoint
ALTER TABLE "entity_memberships" ADD CONSTRAINT "entity_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "entity_memberships" ADD CONSTRAINT "entity_memberships_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "entity_memberships" ("user_id", "entity_id", "role")
SELECT "id", '11111111-1111-4111-8111-111111111111', "role" FROM "users";
--> statement-breakpoint
INSERT INTO "entity_memberships" ("user_id", "entity_id", "role")
SELECT "id", '22222222-2222-4222-8222-222222222222', "role" FROM "users";
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "active_entity_id" uuid;
--> statement-breakpoint
UPDATE "sessions" SET "active_entity_id" = '11111111-1111-4111-8111-111111111111';
--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "active_entity_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_active_entity_id_entities_id_fk" FOREIGN KEY ("active_entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "entity_id" uuid;
--> statement-breakpoint
UPDATE "brands" SET "entity_id" = '11111111-1111-4111-8111-111111111111';
--> statement-breakpoint
ALTER TABLE "brands" ALTER COLUMN "entity_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "brands" DROP CONSTRAINT "brands_slug_unique";
--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_entity_slug_unique" UNIQUE("entity_id","slug");
--> statement-breakpoint
INSERT INTO "brands" ("id", "entity_id", "name", "slug")
VALUES ('33333333-3333-4333-8333-333333333333', '22222222-2222-4222-8222-222222222222', 'Service Contracts', 'service-contracts');
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "entity_id" uuid;
--> statement-breakpoint
UPDATE "customers" SET "entity_id" = '11111111-1111-4111-8111-111111111111';
--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "entity_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "entity_id" uuid;
--> statement-breakpoint
UPDATE "properties" SET "entity_id" = '11111111-1111-4111-8111-111111111111';
--> statement-breakpoint
ALTER TABLE "properties" ALTER COLUMN "entity_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "entity_id" uuid;
--> statement-breakpoint
UPDATE "requests" SET "entity_id" = '11111111-1111-4111-8111-111111111111';
--> statement-breakpoint
ALTER TABLE "requests" ALTER COLUMN "entity_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "entity_id" uuid;
--> statement-breakpoint
UPDATE "quotes" SET "entity_id" = '11111111-1111-4111-8111-111111111111';
--> statement-breakpoint
ALTER TABLE "quotes" ALTER COLUMN "entity_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quotes" DROP CONSTRAINT "quotes_number_unique";
--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_entity_number_unique" UNIQUE("entity_id","number");
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "entity_id" uuid;
--> statement-breakpoint
UPDATE "jobs" SET "entity_id" = '11111111-1111-4111-8111-111111111111';
--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "entity_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_number_unique";
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_entity_number_unique" UNIQUE("entity_id","number");
--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "entity_id" uuid;
--> statement-breakpoint
UPDATE "visits" SET "entity_id" = '11111111-1111-4111-8111-111111111111';
--> statement-breakpoint
ALTER TABLE "visits" ALTER COLUMN "entity_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "form_templates" ADD COLUMN "entity_id" uuid;
--> statement-breakpoint
UPDATE "form_templates" SET "entity_id" = '11111111-1111-4111-8111-111111111111';
--> statement-breakpoint
ALTER TABLE "form_templates" ALTER COLUMN "entity_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "form_templates" ADD CONSTRAINT "form_templates_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "entity_id" uuid;
--> statement-breakpoint
UPDATE "invoices" SET "entity_id" = '11111111-1111-4111-8111-111111111111';
--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "entity_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_number_unique";
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_entity_number_unique" UNIQUE("entity_id","number");
--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "entity_id" uuid;
--> statement-breakpoint
UPDATE "api_tokens" SET "entity_id" = '11111111-1111-4111-8111-111111111111';
--> statement-breakpoint
ALTER TABLE "api_tokens" ALTER COLUMN "entity_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD COLUMN "entity_id" uuid;
--> statement-breakpoint
UPDATE "webhook_endpoints" SET "entity_id" = '11111111-1111-4111-8111-111111111111';
--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ALTER COLUMN "entity_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "counters" ADD COLUMN "entity_id" uuid;
--> statement-breakpoint
UPDATE "counters" SET "entity_id" = '11111111-1111-4111-8111-111111111111';
--> statement-breakpoint
ALTER TABLE "counters" DROP CONSTRAINT "counters_pkey";
--> statement-breakpoint
ALTER TABLE "counters" ALTER COLUMN "entity_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "counters" ADD CONSTRAINT "counters_entity_id_name_pk" PRIMARY KEY("entity_id","name");
--> statement-breakpoint
ALTER TABLE "counters" ADD CONSTRAINT "counters_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE TYPE "public"."contract_status" AS ENUM('draft', 'active', 'ended');
--> statement-breakpoint
CREATE TABLE "contracts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "entity_id" uuid NOT NULL,
  "customer_id" uuid NOT NULL,
  "property_id" uuid NOT NULL,
  "starts_on" date NOT NULL,
  "ends_on" date,
  "status" "contract_status" DEFAULT 'draft' NOT NULL,
  "notes" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "contracts_entity_idx" ON "contracts" USING btree ("entity_id");
--> statement-breakpoint
CREATE TABLE "entity_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "kind" text NOT NULL,
  "from_entity_id" uuid NOT NULL,
  "from_record_id" uuid NOT NULL,
  "to_entity_id" uuid NOT NULL,
  "to_record_id" uuid NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "entity_links_distinct_entities" CHECK ("from_entity_id" <> "to_entity_id")
);
--> statement-breakpoint
ALTER TABLE "entity_links" ADD CONSTRAINT "entity_links_from_entity_id_entities_id_fk" FOREIGN KEY ("from_entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "entity_links" ADD CONSTRAINT "entity_links_to_entity_id_entities_id_fk" FOREIGN KEY ("to_entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "entity_links_from_idx" ON "entity_links" USING btree ("from_entity_id");
--> statement-breakpoint
CREATE INDEX "entity_links_to_idx" ON "entity_links" USING btree ("to_entity_id");
