CREATE TABLE "event_post" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"embed" jsonb,
	"ping_role" boolean DEFAULT false NOT NULL,
	"note" text,
	"parts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"posted_at" timestamp with time zone,
	"posted_by" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_post" ADD CONSTRAINT "event_post_request_id_event_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."event_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_post" ADD CONSTRAINT "event_post_posted_by_user_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_post" ADD CONSTRAINT "event_post_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_post_one_live_per_kind" ON "event_post" USING btree ("request_id","kind") WHERE "event_post"."status" <> 'deleted' and "event_post"."kind" in ('team', 'announcement', 'reminder');