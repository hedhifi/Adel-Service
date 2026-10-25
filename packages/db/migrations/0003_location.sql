ALTER TABLE "company_settings" ADD COLUMN "tracking_start" text DEFAULT '07:00' NOT NULL;
--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "tracking_end" text DEFAULT '18:00' NOT NULL;
--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "location_retention_days" integer DEFAULT 14 NOT NULL;
--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "report_reminders_enabled" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "report_reminder_grace_seconds" integer DEFAULT 120 NOT NULL;
--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "latitude" double precision;
--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "longitude" double precision;
--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "report_reminded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "report_reminder_due_at" timestamp with time zone;
--> statement-breakpoint
CREATE TABLE "device_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "name" text NOT NULL,
  "token_hash" text NOT NULL,
  "token_prefix" text NOT NULL,
  "acknowledged_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "device_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX "device_tokens_token_hash_unique" ON "device_tokens" USING btree ("token_hash");
--> statement-breakpoint
CREATE INDEX "device_tokens_user_idx" ON "device_tokens" USING btree ("user_id");
--> statement-breakpoint
CREATE TABLE "location_points" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "device_token_id" uuid NOT NULL,
  "recorded_at" timestamp with time zone NOT NULL,
  "latitude" double precision NOT NULL,
  "longitude" double precision NOT NULL,
  "accuracy_meters" double precision NOT NULL,
  "battery_percent" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "location_points_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "location_points_device_token_id_device_tokens_id_fk" FOREIGN KEY ("device_token_id") REFERENCES "public"."device_tokens"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "location_points_user_time_idx" ON "location_points" USING btree ("user_id","recorded_at");
--> statement-breakpoint
CREATE TYPE "geofence_kind" AS ENUM('arrive', 'depart');
--> statement-breakpoint
CREATE TABLE "geofence_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "visit_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "kind" "geofence_kind" NOT NULL,
  "recorded_at" timestamp with time zone NOT NULL,
  "latitude" double precision NOT NULL,
  "longitude" double precision NOT NULL,
  CONSTRAINT "geofence_events_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "geofence_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "geofence_events_visit_idx" ON "geofence_events" USING btree ("visit_id","recorded_at");
--> statement-breakpoint
CREATE TABLE "notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "visit_id" uuid,
  "body" text NOT NULL,
  "href" text NOT NULL,
  "push_status" text DEFAULT 'unavailable' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "read_at" timestamp with time zone,
  CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "notifications_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");
