ALTER TABLE "event_checkin" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "event_checkin" CASCADE;--> statement-breakpoint
ALTER TABLE "event_fallback" DROP CONSTRAINT "event_fallback_image_upload_id_event_upload_id_fk";
--> statement-breakpoint
ALTER TABLE "event_request" ALTER COLUMN "brief_version" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "event_fallback" DROP COLUMN "image_upload_id";--> statement-breakpoint
DELETE FROM event_fallback WHERE key IN ('staff-missing','too-few-players') AND btrim(what_we_do) = '' AND btrim(who_decides) = '' AND player_message IS NULL;--> statement-breakpoint
UPDATE event_fallback SET required = false WHERE key IN ('staff-missing','too-few-players');--> statement-breakpoint
DELETE FROM event_checklist_item WHERE key IS NOT NULL AND done_at IS NULL;--> statement-breakpoint
UPDATE event_request r SET brief_version = 0 WHERE brief_version = 1 AND EXISTS (SELECT 1 FROM event_brief_version v WHERE v.request_id = r.id AND v.version = 1 AND btrim(v.body) = '');--> statement-breakpoint
DELETE FROM event_brief_version v USING event_request r WHERE v.request_id = r.id AND r.brief_version = 0;--> statement-breakpoint
DELETE FROM event_upload WHERE purpose = 'fallback';
