CREATE TABLE "code_link" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"system_id" text NOT NULL,
	"task_id" integer,
	"repo_id" text NOT NULL,
	"kind" text NOT NULL,
	"ref_key" text NOT NULL,
	"target_key" text NOT NULL,
	"number" integer,
	"sha" text,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"state" text NOT NULL,
	"checks" text,
	"closes" boolean DEFAULT false NOT NULL,
	"author_login" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "code_link_ref" UNIQUE("repo_id","ref_key","target_key")
);
--> statement-breakpoint
CREATE TABLE "github_account" (
	"user_id" text PRIMARY KEY NOT NULL,
	"github_id" bigint NOT NULL,
	"login" text NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_account_github_id_unique" UNIQUE("github_id")
);
--> statement-breakpoint
CREATE TABLE "github_app" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" integer NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"owner_login" text NOT NULL,
	"html_url" text NOT NULL,
	"client_id" text NOT NULL,
	"client_secret_enc" text NOT NULL,
	"private_key_enc" text NOT NULL,
	"webhook_secret_enc" text NOT NULL,
	"previous_webhook_secret_enc" text,
	"previous_secret_expires_at" timestamp with time zone,
	"link_policy" text DEFAULT 'owners' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_delivery" (
	"delivery_id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"event" text NOT NULL,
	"repo_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"detail" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_install_request" (
	"id" text PRIMARY KEY NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dismissed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "github_installation" (
	"id" bigint PRIMARY KEY NOT NULL,
	"account_login" text NOT NULL,
	"account_type" text NOT NULL,
	"repository_selection" text NOT NULL,
	"repo_count" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"installed_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_repo" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"full_name" text NOT NULL,
	"full_name_key" text NOT NULL,
	"github_repo_id" bigint,
	"installation_id" bigint,
	"mode" text NOT NULL,
	"access" text DEFAULT 'ok' NOT NULL,
	"private" boolean,
	"webhook_secret_enc" text,
	"rules" jsonb DEFAULT '{"closeOnMerge":false,"reviewOnOpen":false,"checksWarning":false}'::jsonb NOT NULL,
	"last_event_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_repo_full_name_key_unique" UNIQUE("full_name_key")
);
--> statement-breakpoint
ALTER TABLE "code_link" ADD CONSTRAINT "code_link_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_link" ADD CONSTRAINT "code_link_system_id_system_id_fk" FOREIGN KEY ("system_id") REFERENCES "public"."system"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_link" ADD CONSTRAINT "code_link_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_link" ADD CONSTRAINT "code_link_repo_id_github_repo_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."github_repo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_account" ADD CONSTRAINT "github_account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_app" ADD CONSTRAINT "github_app_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_delivery" ADD CONSTRAINT "github_delivery_repo_id_github_repo_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."github_repo"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_install_request" ADD CONSTRAINT "github_install_request_requested_by_user_id_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_installation" ADD CONSTRAINT "github_installation_installed_by_user_id_user_id_fk" FOREIGN KEY ("installed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_repo" ADD CONSTRAINT "github_repo_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_repo" ADD CONSTRAINT "github_repo_installation_id_github_installation_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."github_installation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_repo" ADD CONSTRAINT "github_repo_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "code_link_system_idx" ON "code_link" USING btree ("system_id");--> statement-breakpoint
CREATE INDEX "code_link_repo_sha_idx" ON "code_link" USING btree ("repo_id","sha");--> statement-breakpoint
CREATE INDEX "github_delivery_received_idx" ON "github_delivery" USING btree ("received_at");