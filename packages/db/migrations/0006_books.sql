-- QuickBooks sandbox sync (one company per partition) and intercompany charges.
-- Invoice and bill ids on a charge are not foreign keys. They are link-layer endpoints.
CREATE TYPE "qbo_environment" AS ENUM ('sandbox');
--> statement-breakpoint
CREATE TYPE "qbo_provider" AS ENUM ('mock', 'intuit');
--> statement-breakpoint
CREATE TYPE "qbo_resource" AS ENUM ('customer', 'item', 'invoice', 'payment', 'vendor', 'bill', 'bill_payment');
--> statement-breakpoint
CREATE TYPE "qbo_sync_status" AS ENUM ('synced', 'failed', 'conflict', 'pending');
--> statement-breakpoint
CREATE TYPE "intercompany_kind" AS ENUM ('labor', 'material', 'shared');
--> statement-breakpoint
CREATE TYPE "intercompany_charge_status" AS ENUM ('open', 'invoiced', 'void');
--> statement-breakpoint
CREATE TYPE "bill_status" AS ENUM ('draft', 'issued', 'partial', 'paid', 'void');
--> statement-breakpoint
CREATE TABLE "catalog_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "entity_id" uuid NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "kind" "line_kind" DEFAULT 'other' NOT NULL,
  "sku" text,
  "unit_amount_cents" integer NOT NULL,
  "taxable" boolean DEFAULT false NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "catalog_items_entity_name_unique" UNIQUE("entity_id","name")
);
--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "catalog_items_entity_idx" ON "catalog_items" USING btree ("entity_id");
--> statement-breakpoint
CREATE TABLE "vendors" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "entity_id" uuid NOT NULL,
  "name" text NOT NULL,
  "notes" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "vendors_entity_name_unique" UNIQUE("entity_id","name")
);
--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "bills" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "entity_id" uuid NOT NULL,
  "number" integer NOT NULL,
  "vendor_id" uuid NOT NULL,
  "status" "bill_status" DEFAULT 'draft' NOT NULL,
  "tax_rate_bps" integer DEFAULT 0 NOT NULL,
  "issued_at" timestamptz,
  "due_at" timestamptz,
  "notes" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "bills_entity_number_unique" UNIQUE("entity_id","number")
);
--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "bills_entity_idx" ON "bills" USING btree ("entity_id");
--> statement-breakpoint
CREATE TABLE "bill_line_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "bill_id" uuid NOT NULL,
  "position" integer NOT NULL,
  "kind" "line_kind" DEFAULT 'other' NOT NULL,
  "description" text NOT NULL,
  "quantity" numeric(10, 2) NOT NULL,
  "unit_amount_cents" integer NOT NULL,
  "taxable" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bill_line_items" ADD CONSTRAINT "bill_line_items_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "bill_lines_bill_idx" ON "bill_line_items" USING btree ("bill_id");
--> statement-breakpoint
CREATE TABLE "bill_payments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "bill_id" uuid NOT NULL,
  "amount_cents" integer NOT NULL,
  "status" "payment_status" NOT NULL,
  "method" "payment_method" NOT NULL,
  "reference" text,
  "recorded_by_id" uuid,
  "received_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bill_payments" ADD CONSTRAINT "bill_payments_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bill_payments" ADD CONSTRAINT "bill_payments_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "bill_payments_bill_idx" ON "bill_payments" USING btree ("bill_id");
--> statement-breakpoint
CREATE TABLE "qbo_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "entity_id" uuid NOT NULL,
  "environment" "qbo_environment" DEFAULT 'sandbox' NOT NULL,
  "provider" "qbo_provider" DEFAULT 'mock' NOT NULL,
  "realm_id" text NOT NULL,
  "company_name" text NOT NULL,
  "access_token" text,
  "refresh_token" text,
  "token_expires_at" timestamptz,
  "connected_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "qbo_connections_entity_unique" UNIQUE("entity_id"),
  CONSTRAINT "qbo_connections_realm_unique" UNIQUE("realm_id")
);
--> statement-breakpoint
ALTER TABLE "qbo_connections" ADD CONSTRAINT "qbo_connections_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "qbo_mappings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "entity_id" uuid NOT NULL,
  "resource_type" "qbo_resource" NOT NULL,
  "resource_id" uuid NOT NULL,
  "realm_id" text NOT NULL,
  "qbo_id" text NOT NULL,
  "sync_token" text NOT NULL,
  "local_hash" text NOT NULL,
  "remote_hash" text NOT NULL,
  "last_synced_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "qbo_mappings_local_unique" UNIQUE("entity_id","resource_type","resource_id"),
  CONSTRAINT "qbo_mappings_remote_unique" UNIQUE("realm_id","resource_type","qbo_id")
);
--> statement-breakpoint
ALTER TABLE "qbo_mappings" ADD CONSTRAINT "qbo_mappings_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "qbo_sync_state" (
  "entity_id" uuid NOT NULL,
  "resource_type" "qbo_resource" NOT NULL,
  "resource_id" uuid NOT NULL,
  "status" "qbo_sync_status" NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "next_retry_at" timestamptz,
  "last_error" text,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "qbo_sync_state_entity_id_resource_type_resource_id_pk" PRIMARY KEY("entity_id","resource_type","resource_id")
);
--> statement-breakpoint
ALTER TABLE "qbo_sync_state" ADD CONSTRAINT "qbo_sync_state_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "qbo_sync_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "entity_id" uuid NOT NULL,
  "resource_type" "qbo_resource" NOT NULL,
  "resource_id" uuid NOT NULL,
  "direction" text NOT NULL,
  "status" "qbo_sync_status" NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "message" text,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "qbo_sync_log" ADD CONSTRAINT "qbo_sync_log_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "qbo_sync_log_entity_idx" ON "qbo_sync_log" USING btree ("entity_id","created_at");
--> statement-breakpoint
CREATE TABLE "qbo_sandbox_objects" (
  "realm_id" text NOT NULL,
  "qbo_type" text NOT NULL,
  "qbo_id" text NOT NULL,
  "sync_token" integer NOT NULL,
  "payload" jsonb NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "qbo_sandbox_objects_realm_id_qbo_type_qbo_id_pk" PRIMARY KEY("realm_id","qbo_type","qbo_id")
);
--> statement-breakpoint
CREATE TABLE "intercompany_rates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "supplying_entity_id" uuid NOT NULL,
  "consuming_entity_id" uuid NOT NULL,
  "kind" "intercompany_kind" NOT NULL,
  "name" text NOT NULL,
  "unit" text NOT NULL,
  "unit_amount_cents" integer NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "intercompany_rates_name_unique" UNIQUE("supplying_entity_id","consuming_entity_id","name"),
  CONSTRAINT "intercompany_rates_distinct_chk" CHECK ("supplying_entity_id" <> "consuming_entity_id"),
  CONSTRAINT "intercompany_rates_amount_chk" CHECK ("unit_amount_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "intercompany_rates" ADD CONSTRAINT "intercompany_rates_supplying_entity_id_entities_id_fk" FOREIGN KEY ("supplying_entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "intercompany_rates" ADD CONSTRAINT "intercompany_rates_consuming_entity_id_entities_id_fk" FOREIGN KEY ("consuming_entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "intercompany_rates_supplying_idx" ON "intercompany_rates" USING btree ("supplying_entity_id");
--> statement-breakpoint
CREATE TABLE "intercompany_charges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "supplying_entity_id" uuid NOT NULL,
  "consuming_entity_id" uuid NOT NULL,
  "rate_id" uuid,
  "kind" "intercompany_kind" NOT NULL,
  "description" text NOT NULL,
  "quantity" numeric(10, 2) NOT NULL,
  "unit_amount_cents" integer NOT NULL,
  "source_visit_id" uuid,
  "technician_user_id" uuid,
  "status" "intercompany_charge_status" DEFAULT 'open' NOT NULL,
  "supplier_invoice_id" uuid,
  "consumer_bill_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "intercompany_charges_distinct_chk" CHECK ("supplying_entity_id" <> "consuming_entity_id"),
  CONSTRAINT "intercompany_charges_amount_chk" CHECK ("unit_amount_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "intercompany_charges" ADD CONSTRAINT "intercompany_charges_supplying_entity_id_entities_id_fk" FOREIGN KEY ("supplying_entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "intercompany_charges" ADD CONSTRAINT "intercompany_charges_consuming_entity_id_entities_id_fk" FOREIGN KEY ("consuming_entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "intercompany_charges" ADD CONSTRAINT "intercompany_charges_rate_id_intercompany_rates_id_fk" FOREIGN KEY ("rate_id") REFERENCES "public"."intercompany_rates"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "intercompany_charges" ADD CONSTRAINT "intercompany_charges_technician_user_id_users_id_fk" FOREIGN KEY ("technician_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "intercompany_charges_supplying_idx" ON "intercompany_charges" USING btree ("supplying_entity_id");
--> statement-breakpoint
CREATE INDEX "intercompany_charges_consuming_idx" ON "intercompany_charges" USING btree ("consuming_entity_id");
