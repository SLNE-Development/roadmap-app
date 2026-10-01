CREATE TABLE "adr_task" (
	"adr_id" text NOT NULL,
	"task_id" integer NOT NULL,
	CONSTRAINT "adr_task_adr_id_task_id_pk" PRIMARY KEY("adr_id","task_id")
);
--> statement-breakpoint
ALTER TABLE "adr_task" ADD CONSTRAINT "adr_task_adr_id_adr_id_fk" FOREIGN KEY ("adr_id") REFERENCES "public"."adr"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adr_task" ADD CONSTRAINT "adr_task_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "adr_task_task_id_idx" ON "adr_task" USING btree ("task_id");