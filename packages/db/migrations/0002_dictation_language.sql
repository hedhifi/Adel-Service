ALTER TABLE "users" ADD COLUMN "dictation_language" text DEFAULT 'en' NOT NULL;
--> statement-breakpoint
ALTER TABLE "visit_notes" ADD COLUMN "source_language" text;
