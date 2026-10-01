CREATE TABLE "agent_call" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"tool" text NOT NULL,
	"transport" text NOT NULL,
	"agent" text,
	"project_id" text,
	"system_slug" text,
	"target" text,
	"ok" boolean NOT NULL,
	"status" integer NOT NULL,
	"error" text,
	"duration_ms" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_run" (
	"id" text PRIMARY KEY NOT NULL,
	"api_key_id" text NOT NULL,
	"user_id" text NOT NULL,
	"title" text,
	"repo" text,
	"branch" text,
	"client_session_id" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_call_at" timestamp with time zone DEFAULT now() NOT NULL,
	"call_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"input_tokens" bigint,
	"output_tokens" bigint,
	"cache_read_tokens" bigint,
	"cache_write_tokens" bigint
);
--> statement-breakpoint
ALTER TABLE "agent_call" ADD CONSTRAINT "agent_call_run_id_agent_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_call" ADD CONSTRAINT "agent_call_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_call_run" ON "agent_call" USING btree ("run_id","id");--> statement-breakpoint
CREATE INDEX "agent_call_project_at" ON "agent_call" USING btree ("project_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "agent_call_at" ON "agent_call" USING btree ("at");--> statement-breakpoint
CREATE INDEX "agent_run_key_last_call" ON "agent_run" USING btree ("api_key_id","last_call_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "agent_run_user_last_call" ON "agent_run" USING btree ("user_id","last_call_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "agent_run_client_session" ON "agent_run" USING btree ("client_session_id") WHERE client_session_id is not null;