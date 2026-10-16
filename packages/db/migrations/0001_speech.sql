ALTER TABLE "visits" ADD COLUMN "signed_by_raw" text;
--> statement-breakpoint
ALTER TABLE "visit_notes" ADD COLUMN "raw_body" text;
--> statement-breakpoint
ALTER TABLE "visit_photos" ADD COLUMN "raw_caption" text;
--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "raw_note" text;
--> statement-breakpoint
CREATE TYPE "speech_term_status" AS ENUM('active', 'suggested');
--> statement-breakpoint
CREATE TABLE "speech_terms" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "phrase" text NOT NULL,
  "status" "speech_term_status" DEFAULT 'active' NOT NULL,
  "created_by_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "speech_terms" ADD CONSTRAINT "speech_terms_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "speech_terms_phrase_idx" ON "speech_terms" USING btree (lower("phrase"));
--> statement-breakpoint
CREATE INDEX "speech_terms_status_idx" ON "speech_terms" USING btree ("status");
