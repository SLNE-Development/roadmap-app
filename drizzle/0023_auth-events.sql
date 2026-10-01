CREATE TABLE "auth_event" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"user_id" text,
	"discord_id" text,
	"api_key_id" text,
	"ip" text,
	"user_agent" text,
	"detail" text
);
--> statement-breakpoint
ALTER TABLE "auth_event" ADD CONSTRAINT "auth_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_event_at" ON "auth_event" USING btree ("at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "auth_event_user_at" ON "auth_event" USING btree ("user_id","at" DESC NULLS LAST);