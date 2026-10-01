CREATE TABLE "discord_outbox" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"webhook_id" text NOT NULL,
	"change_log_id" bigint NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "discord_outbox_unique" UNIQUE("webhook_id","change_log_id")
);
--> statement-breakpoint
CREATE TABLE "project_webhook" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"url_enc" text NOT NULL,
	"url_hint" text NOT NULL,
	"events" text[] NOT NULL,
	"board_ids" text[] DEFAULT '{}' NOT NULL,
	"digest" boolean DEFAULT false NOT NULL,
	"time_zone" text DEFAULT 'UTC' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"disabled_reason" text,
	"last_sent_at" timestamp with time zone,
	"last_digest_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
ALTER TABLE "discord_outbox" ADD CONSTRAINT "discord_outbox_webhook_id_project_webhook_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."project_webhook"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_webhook" ADD CONSTRAINT "project_webhook_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_webhook" ADD CONSTRAINT "project_webhook_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discord_outbox_webhook_sent" ON "discord_outbox" USING btree ("webhook_id","sent_at");