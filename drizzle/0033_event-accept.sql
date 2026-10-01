CREATE TABLE "event_spec_basis" (
	"system_id" text NOT NULL,
	"spec_version" integer NOT NULL,
	"brief_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_spec_basis_system_id_spec_version_pk" PRIMARY KEY("system_id","spec_version")
);
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "deadline" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_spec_basis" ADD CONSTRAINT "event_spec_basis_system_id_system_id_fk" FOREIGN KEY ("system_id") REFERENCES "public"."system"("id") ON DELETE cascade ON UPDATE no action;