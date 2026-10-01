ALTER TABLE "task" ADD COLUMN "notes" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "blocked_reason" text;