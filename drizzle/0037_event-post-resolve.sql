ALTER TABLE "event_post" ADD COLUMN "edit_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "event_post" ADD COLUMN "resolved_at" timestamp with time zone;