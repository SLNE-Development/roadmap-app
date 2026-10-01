CREATE TABLE "event_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"public_webhook_enc" text,
	"public_webhook_hint" text,
	"team_webhook_enc" text,
	"team_webhook_hint" text,
	"staff_webhook_enc" text,
	"staff_webhook_hint" text,
	"bot_token_enc" text,
	"bot_token_hint" text,
	"post_as" text DEFAULT 'Event-Team' NOT NULL,
	"ping_role_id" text,
	"guild_id" text,
	"time_zone" text DEFAULT 'Europe/Berlin' NOT NULL,
	"rulebook_url" text,
	"announcement_style" text DEFAULT '' NOT NULL,
	"announcement_example" text DEFAULT '' NOT NULL,
	"reminder_example" text DEFAULT '' NOT NULL,
	"team_style" text DEFAULT '' NOT NULL,
	"team_example" text DEFAULT '' NOT NULL,
	"disaster_template" jsonb DEFAULT '{"title":"Wir arbeiten an einer Lösung","text":"{event} ist gerade nicht erreichbar. Wir arbeiten an einer Lösung und melden uns hier, sobald es weitergeht.","color":"#c23636","imageUploadId":null}'::jsonb NOT NULL,
	"resolved_template" jsonb DEFAULT '{"title":"Das Event ist nun wieder online","text":"{event} läuft wieder. {note}","color":"#1a7048","imageUploadId":null}'::jsonb NOT NULL,
	"details_template" jsonb DEFAULT '{"lines":["Datum: {date}","Uhrzeit: {time}","Dauer: {duration}","Ort: {where}","Infos: {docs}","Regeln: {rules}"],"color":"#2a5db0","footer":"Viel Spaß!"}'::jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_settings" ADD CONSTRAINT "event_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;