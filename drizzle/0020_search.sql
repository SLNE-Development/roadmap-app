ALTER TABLE "adr" ADD COLUMN "search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(title,'')), 'A') || setweight(to_tsvector('english', coalesce(context,'') || ' ' || coalesce(decision,'') || ' ' || coalesce(alternatives,'') || ' ' || coalesce(consequences,'')), 'B')) STORED;--> statement-breakpoint
ALTER TABLE "page_version" ADD COLUMN "search" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', body)) STORED;--> statement-breakpoint
ALTER TABLE "question" ADD COLUMN "search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(title,'')), 'A') || setweight(to_tsvector('english', coalesce(text,'')), 'B') || setweight(to_tsvector('english', coalesce(answer,'')), 'C')) STORED;--> statement-breakpoint
ALTER TABLE "system" ADD COLUMN "search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(title,'')), 'A') || setweight(to_tsvector('english', coalesce(summary,'')), 'B') || setweight(to_tsvector('english', coalesce(notes,'')), 'C')) STORED;--> statement-breakpoint
ALTER TABLE "system_document" ADD COLUMN "search" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', body)) STORED;--> statement-breakpoint
CREATE INDEX "adr_search" ON "adr" USING gin ("search");--> statement-breakpoint
CREATE INDEX "page_version_search" ON "page_version" USING gin ("search");--> statement-breakpoint
CREATE INDEX "question_search" ON "question" USING gin ("search");--> statement-breakpoint
CREATE INDEX "system_search" ON "system" USING gin ("search");--> statement-breakpoint
CREATE INDEX "system_document_search" ON "system_document" USING gin ("search");