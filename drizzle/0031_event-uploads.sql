CREATE TABLE "event_upload" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text,
	"uploader_id" text,
	"purpose" text NOT NULL,
	"original_name" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_upload_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
ALTER TABLE "event_upload" ADD CONSTRAINT "event_upload_request_id_event_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."event_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_upload" ADD CONSTRAINT "event_upload_uploader_id_user_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_upload_request" ON "event_upload" USING btree ("request_id");--> statement-breakpoint
ALTER TABLE "event_request" ADD CONSTRAINT "event_request_banner_upload_id_event_upload_id_fk" FOREIGN KEY ("banner_upload_id") REFERENCES "public"."event_upload"("id") ON DELETE set null ON UPDATE no action;