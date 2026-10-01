ALTER TABLE "event_request" ADD COLUMN "project_created" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE event_request r SET project_created = true FROM project p WHERE p.id = r.project_id AND r.accepted_at IS NOT NULL AND p.created_at BETWEEN r.accepted_at - interval '5 seconds' AND r.accepted_at + interval '60 seconds';
