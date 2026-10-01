CREATE TABLE "system_dependency" (
	"system_id" text NOT NULL,
	"depends_on_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_dependency_system_id_depends_on_id_pk" PRIMARY KEY("system_id","depends_on_id")
);
--> statement-breakpoint
ALTER TABLE "system_dependency" ADD CONSTRAINT "system_dependency_system_id_system_id_fk" FOREIGN KEY ("system_id") REFERENCES "public"."system"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_dependency" ADD CONSTRAINT "system_dependency_depends_on_id_system_id_fk" FOREIGN KEY ("depends_on_id") REFERENCES "public"."system"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "system_dependency_depends_on_id_idx" ON "system_dependency" USING btree ("depends_on_id");