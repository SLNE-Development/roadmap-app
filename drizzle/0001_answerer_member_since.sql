ALTER TABLE "project_member" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "question" ADD COLUMN "answered_by_user_id" text;--> statement-breakpoint
ALTER TABLE "question" ADD COLUMN "answered_agent" text;--> statement-breakpoint
ALTER TABLE "question" ADD COLUMN "answered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_answered_by_user_id_user_id_fk" FOREIGN KEY ("answered_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Backfill: the newest "answer" change of each answered question names who answered it and when.
UPDATE "question" AS q
SET "answered_by_user_id" = c."author_user_id", "answered_agent" = c."agent", "answered_at" = c."created_at"
FROM (
  SELECT DISTINCT ON ("entity_id") "entity_id", "author_user_id", "agent", "created_at"
  FROM "change_log"
  WHERE "entity" = 'question' AND "field" = 'answer'
  ORDER BY "entity_id", "id" DESC
) AS c
WHERE c."entity_id" = q."id" AND q."answer" IS NOT NULL AND q."answered_at" IS NULL;--> statement-breakpoint
-- Backfill: members joined when they were last added (a role change without a previous role), else when the project was created.
UPDATE "project_member" AS pm
SET "created_at" = COALESCE(
  (
    SELECT max(c."created_at") FROM "change_log" AS c
    WHERE c."project_id" = pm."project_id" AND c."entity" = 'member' AND c."field" = 'role'
      AND c."entity_id" = pm."user_id" AND c."old_value" IS NULL
  ),
  (SELECT p."created_at" FROM "project" AS p WHERE p."id" = pm."project_id")
);
