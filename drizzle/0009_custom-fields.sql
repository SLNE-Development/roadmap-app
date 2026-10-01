CREATE TABLE "custom_field" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_field_project_key" UNIQUE("project_id","key")
);
--> statement-breakpoint
CREATE TABLE "system_field_value" (
	"system_id" text NOT NULL,
	"field_id" text NOT NULL,
	"value" text NOT NULL,
	CONSTRAINT "system_field_value_system_id_field_id_pk" PRIMARY KEY("system_id","field_id")
);
--> statement-breakpoint
ALTER TABLE "custom_field" ADD CONSTRAINT "custom_field_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_field_value" ADD CONSTRAINT "system_field_value_system_id_system_id_fk" FOREIGN KEY ("system_id") REFERENCES "public"."system"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_field_value" ADD CONSTRAINT "system_field_value_field_id_custom_field_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."custom_field"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "system_field_value_field_id_idx" ON "system_field_value" USING btree ("field_id");