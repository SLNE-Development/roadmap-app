CREATE TABLE "release" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"target_date" date,
	"status" text DEFAULT 'planned' NOT NULL,
	"frozen_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "release_project_slug" UNIQUE("project_id","slug")
);
--> statement-breakpoint
CREATE TABLE "release_note" (
	"id" text PRIMARY KEY NOT NULL,
	"release_id" text NOT NULL,
	"version" integer NOT NULL,
	"body" text NOT NULL,
	"author_user_id" text,
	"agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "release_note_version" UNIQUE("release_id","version")
);
--> statement-breakpoint
ALTER TABLE "system" ADD COLUMN "release_id" text;--> statement-breakpoint
ALTER TABLE "release" ADD CONSTRAINT "release_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_note" ADD CONSTRAINT "release_note_release_id_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."release"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_note" ADD CONSTRAINT "release_note_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system" ADD CONSTRAINT "system_release_id_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."release"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "system_release_idx" ON "system" USING btree ("release_id");