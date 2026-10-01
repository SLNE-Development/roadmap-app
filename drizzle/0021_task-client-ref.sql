ALTER TABLE "task" ADD COLUMN "client_ref" text;--> statement-breakpoint
CREATE UNIQUE INDEX "task_client_ref" ON "task" USING btree ("system_id","client_ref");