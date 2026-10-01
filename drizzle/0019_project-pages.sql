CREATE TABLE "page_version" (
	"id" text PRIMARY KEY NOT NULL,
	"page_id" text NOT NULL,
	"version" integer NOT NULL,
	"body" text NOT NULL,
	"author_user_id" text,
	"agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_version_page_version" UNIQUE("page_id","version")
);
--> statement-breakpoint
CREATE TABLE "project_page" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_page_project_slug" UNIQUE("project_id","slug")
);
--> statement-breakpoint
ALTER TABLE "page_version" ADD CONSTRAINT "page_version_page_id_project_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."project_page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_version" ADD CONSTRAINT "page_version_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_page" ADD CONSTRAINT "project_page_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;