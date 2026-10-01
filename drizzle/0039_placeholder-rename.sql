-- Custom SQL migration file, put your code below! --
UPDATE "event_settings" SET
	"details_template" = replace(replace("details_template"::text, '{date}', '{start_date}'), '{time}', '{start_time}')::jsonb,
	"disaster_template" = replace(replace("disaster_template"::text, '{date}', '{start_date}'), '{time}', '{start_time}')::jsonb,
	"resolved_template" = replace(replace("resolved_template"::text, '{date}', '{start_date}'), '{time}', '{start_time}')::jsonb;--> statement-breakpoint
UPDATE "event_post" SET "text" = replace(replace("text", '{date}', '{start_date}'), '{time}', '{start_time}') WHERE "status" = 'draft';--> statement-breakpoint
ALTER TABLE "event_settings" ALTER COLUMN "disaster_template" SET DEFAULT '{"title":"Wir arbeiten an einer Lösung","text":"{event} ist gerade nicht erreichbar. Wir arbeiten an einer Lösung und melden uns hier, sobald es weitergeht.\n\n{note}","color":"#c23636","imageUploadId":null}'::jsonb;--> statement-breakpoint
ALTER TABLE "event_settings" ALTER COLUMN "details_template" SET DEFAULT '{"lines":["Start: {start}","Ende: {end_time}","Ort: {where}","Infos: {docs}","Regeln: {rules}"],"color":"#2a5db0","footer":"Viel Spaß!"}'::jsonb;
