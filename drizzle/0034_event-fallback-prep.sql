CREATE TABLE "event_checkin" (
	"request_id" text NOT NULL,
	"user_id" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_checkin_request_id_user_id_pk" PRIMARY KEY("request_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "event_checklist_item" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"key" text,
	"label" text NOT NULL,
	"done_at" timestamp with time zone,
	"done_by" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_fallback" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"what_we_do" text DEFAULT '' NOT NULL,
	"who_decides" text DEFAULT '' NOT NULL,
	"player_message" text,
	"image_upload_id" text,
	"required" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "event_fallback_key" UNIQUE("request_id","key")
);
--> statement-breakpoint
CREATE TABLE "event_todo" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"template_key" text,
	"title" text NOT NULL,
	"owner_user_id" text,
	"due_at" timestamp with time zone NOT NULL,
	"due_manual" boolean DEFAULT false NOT NULL,
	"done_at" timestamp with time zone,
	"done_by" text,
	"last_reminded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_checkin" ADD CONSTRAINT "event_checkin_request_id_event_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."event_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_checkin" ADD CONSTRAINT "event_checkin_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_checklist_item" ADD CONSTRAINT "event_checklist_item_request_id_event_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."event_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_checklist_item" ADD CONSTRAINT "event_checklist_item_done_by_user_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_fallback" ADD CONSTRAINT "event_fallback_request_id_event_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."event_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_fallback" ADD CONSTRAINT "event_fallback_image_upload_id_event_upload_id_fk" FOREIGN KEY ("image_upload_id") REFERENCES "public"."event_upload"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_todo" ADD CONSTRAINT "event_todo_request_id_event_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."event_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_todo" ADD CONSTRAINT "event_todo_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_todo" ADD CONSTRAINT "event_todo_done_by_user_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_checklist_request" ON "event_checklist_item" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "event_todo_request" ON "event_todo" USING btree ("request_id");