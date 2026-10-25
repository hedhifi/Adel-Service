CREATE TABLE "receptionist_settings" (
  "entity_id" uuid PRIMARY KEY NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "greeting_en" text NOT NULL,
  "greeting_es" text NOT NULL,
  "hours_start" text DEFAULT '08:00' NOT NULL,
  "hours_end" text DEFAULT '17:00' NOT NULL,
  "hours_days" integer[] NOT NULL,
  "on_call_user_id" uuid,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "receptionist_settings" ADD CONSTRAINT "receptionist_settings_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "receptionist_settings" ADD CONSTRAINT "receptionist_settings_on_call_user_id_users_id_fk" FOREIGN KEY ("on_call_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "receptionist_conversations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "entity_id" uuid NOT NULL,
  "channel" text NOT NULL,
  "language" text NOT NULL,
  "step" text NOT NULL,
  "outcome" text NOT NULL,
  "caller_name" text,
  "caller_phone" text,
  "service_address" text,
  "problem" text,
  "customer_id" uuid,
  "property_id" uuid,
  "request_id" uuid,
  "job_id" uuid,
  "visit_id" uuid,
  "offered_slots" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "receptionist_conversations" ADD CONSTRAINT "receptionist_conversations_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "receptionist_conversations" ADD CONSTRAINT "receptionist_conversations_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "receptionist_conversations" ADD CONSTRAINT "receptionist_conversations_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "receptionist_conversations" ADD CONSTRAINT "receptionist_conversations_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "receptionist_conversations" ADD CONSTRAINT "receptionist_conversations_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "receptionist_conversations" ADD CONSTRAINT "receptionist_conversations_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "receptionist_conversations_entity_idx" ON "receptionist_conversations" USING btree ("entity_id","created_at");
--> statement-breakpoint
CREATE TABLE "receptionist_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "conversation_id" uuid NOT NULL,
  "role" text NOT NULL,
  "body" text NOT NULL,
  "body_en" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "receptionist_messages" ADD CONSTRAINT "receptionist_messages_conversation_id_receptionist_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."receptionist_conversations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "receptionist_messages_conversation_idx" ON "receptionist_messages" USING btree ("conversation_id","created_at");
--> statement-breakpoint
CREATE TABLE "receptionist_sandbox_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "entity_id" uuid NOT NULL,
  "conversation_id" uuid,
  "channel" text NOT NULL,
  "kind" text NOT NULL,
  "to_phone" text,
  "body" text NOT NULL,
  "body_en" text NOT NULL,
  "provider" text NOT NULL,
  "delivered" boolean DEFAULT false NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "receptionist_sandbox_messages" ADD CONSTRAINT "receptionist_sandbox_messages_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "receptionist_sandbox_messages" ADD CONSTRAINT "receptionist_sandbox_messages_conversation_id_receptionist_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."receptionist_conversations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "receptionist_sandbox_entity_idx" ON "receptionist_sandbox_messages" USING btree ("entity_id","created_at");
