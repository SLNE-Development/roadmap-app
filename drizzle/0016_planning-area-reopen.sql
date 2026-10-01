CREATE TABLE "planning_area_reopen" (
	"id" text PRIMARY KEY NOT NULL,
	"system_id" text NOT NULL,
	"area" text NOT NULL,
	"reason" text NOT NULL,
	"reopened_by_user_id" text,
	"agent" text,
	"reopened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"confirmation" text
);
--> statement-breakpoint
ALTER TABLE "planning_area_reopen" ADD CONSTRAINT "planning_area_reopen_system_id_system_id_fk" FOREIGN KEY ("system_id") REFERENCES "public"."system"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_area_reopen" ADD CONSTRAINT "planning_area_reopen_reopened_by_user_id_user_id_fk" FOREIGN KEY ("reopened_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "planning_area_reopen_open_idx" ON "planning_area_reopen" USING btree ("system_id","area") WHERE closed_at is null;