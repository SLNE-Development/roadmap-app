CREATE TABLE "glossary_term" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"term" text NOT NULL,
	"definition" text NOT NULL,
	"aliases" text[] DEFAULT '{}' NOT NULL,
	"updated_by_user_id" text,
	"agent" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "glossary_term" ADD CONSTRAINT "glossary_term_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "glossary_term" ADD CONSTRAINT "glossary_term_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "glossary_term_project_term" ON "glossary_term" USING btree ("project_id",lower("term"));