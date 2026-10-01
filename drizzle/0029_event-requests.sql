CREATE TABLE "event_brief_version" (
	"request_id" text NOT NULL,
	"version" integer NOT NULL,
	"body" text NOT NULL,
	"author_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_brief_version_request_id_version_pk" PRIMARY KEY("request_id","version")
);
--> statement-breakpoint
CREATE TABLE "event_request" (
	"id" text PRIMARY KEY NOT NULL,
	"requester_id" text,
	"title" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"starts_at" timestamp with time zone,
	"duration_minutes" integer,
	"where" text DEFAULT '' NOT NULL,
	"event_docs_url" text,
	"brief_version" integer DEFAULT 1 NOT NULL,
	"project_id" text,
	"system_id" text,
	"discord_event_id" text,
	"banner_upload_id" text,
	"submitted_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"accepted_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"field" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"author_user_id" text,
	"agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "is_event_manager" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "is_event_developer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "event_brief_version" ADD CONSTRAINT "event_brief_version_request_id_event_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."event_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_brief_version" ADD CONSTRAINT "event_brief_version_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_request" ADD CONSTRAINT "event_request_requester_id_user_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_request" ADD CONSTRAINT "event_request_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_request" ADD CONSTRAINT "event_request_system_id_system_id_fk" FOREIGN KEY ("system_id") REFERENCES "public"."system"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_request" ADD CONSTRAINT "event_request_accepted_by_user_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_log" ADD CONSTRAINT "request_log_request_id_event_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."event_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_log" ADD CONSTRAINT "request_log_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_request_requester_status" ON "event_request" USING btree ("requester_id","status");--> statement-breakpoint
CREATE INDEX "event_request_status_starts" ON "event_request" USING btree ("status","starts_at");--> statement-breakpoint
CREATE INDEX "event_request_project" ON "event_request" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "request_log_request_id" ON "request_log" USING btree ("request_id","id");