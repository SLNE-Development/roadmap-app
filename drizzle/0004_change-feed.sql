CREATE TABLE "feed_cursor" (
	"name" text PRIMARY KEY NOT NULL,
	"last_id" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feed_seen" (
	"consumer" text NOT NULL,
	"change_id" bigint NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feed_seen_consumer_change_id_pk" PRIMARY KEY("consumer","change_id")
);
--> statement-breakpoint
CREATE INDEX "feed_seen_seen_at" ON "feed_seen" USING btree ("seen_at");