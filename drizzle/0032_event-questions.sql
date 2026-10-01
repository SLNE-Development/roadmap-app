CREATE TABLE "event_question" (
	"id" text PRIMARY KEY NOT NULL,
	"round_id" text NOT NULL,
	"request_id" text NOT NULL,
	"position" integer NOT NULL,
	"type" text NOT NULL,
	"text" text NOT NULL,
	"why" text,
	"required" boolean DEFAULT true NOT NULL,
	"config" jsonb NOT NULL,
	"suggested" jsonb,
	"answer" jsonb,
	"not_sure" boolean DEFAULT false NOT NULL,
	"answered_by" text,
	"answered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_question_round" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"number" integer NOT NULL,
	"asked_by" text,
	"agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_question_round_number" UNIQUE("request_id","number")
);
--> statement-breakpoint
ALTER TABLE "event_question" ADD CONSTRAINT "event_question_round_id_event_question_round_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."event_question_round"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_question" ADD CONSTRAINT "event_question_request_id_event_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."event_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_question" ADD CONSTRAINT "event_question_answered_by_user_id_fk" FOREIGN KEY ("answered_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_question_round" ADD CONSTRAINT "event_question_round_request_id_event_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."event_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_question_round" ADD CONSTRAINT "event_question_round_asked_by_user_id_fk" FOREIGN KEY ("asked_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_question_request_answered" ON "event_question" USING btree ("request_id","answered_at");