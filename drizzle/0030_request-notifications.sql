ALTER TABLE "notification" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "request_id" text;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_request_id_event_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."event_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_target" CHECK ("notification"."project_id" is not null or "notification"."request_id" is not null);