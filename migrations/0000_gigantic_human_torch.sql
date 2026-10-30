CREATE TABLE "annotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_version_id" uuid NOT NULL,
	"block_id" text NOT NULL,
	"start_utf16" integer NOT NULL,
	"end_utf16" integer NOT NULL,
	"exact_quote" text NOT NULL,
	"quote_hash" text NOT NULL,
	"context_before" text NOT NULL,
	"context_after" text NOT NULL,
	"label" text NOT NULL,
	"comment" text NOT NULL,
	"human_rewrite" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "annotation_offsets" CHECK ("annotations"."start_utf16" >= 0 AND "annotations"."end_utf16" > "annotations"."start_utf16")
);
--> statement-breakpoint
CREATE TABLE "candidate_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"model_provider" text NOT NULL,
	"generation_strategy" text NOT NULL,
	"prompt_version" text NOT NULL,
	"shuffled_order_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"set_id" uuid NOT NULL,
	"document_version_id" uuid NOT NULL,
	"text" text NOT NULL,
	"position" integer NOT NULL,
	"model_details_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "command_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"parent_version_id" uuid,
	"content_text" text NOT NULL,
	"content_json" jsonb NOT NULL,
	"revision_source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"status" text NOT NULL,
	"payload" jsonb NOT NULL,
	"result" jsonb,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"lease_until" timestamp with time zone,
	"lease_token" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"domain" text NOT NULL,
	"genre" text DEFAULT 'general' NOT NULL,
	"settings_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_domain" CHECK ("projects"."domain" IN ('writing','dialogue'))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"state" text DEFAULT 'awaiting_generation' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"source" text NOT NULL,
	"title" text NOT NULL,
	"prompt" text NOT NULL,
	"genre" text NOT NULL,
	"granularity" text NOT NULL,
	"target_dimension" text NOT NULL,
	"difficulty" text DEFAULT 'normal' NOT NULL,
	"constraints_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"generation_id" text,
	"prompt_version" text DEFAULT 'training-v1' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_sets" ADD CONSTRAINT "candidate_sets_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_sets" ADD CONSTRAINT "candidate_sets_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_set_id_candidate_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."candidate_sets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_parent_fk" FOREIGN KEY ("parent_version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_events" ADD CONSTRAINT "feedback_events_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_events" ADD CONSTRAINT "feedback_events_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "annotation_document_idx" ON "annotations" USING btree ("document_version_id","block_id");--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_set_job_idx" ON "candidate_sets" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "candidate_set_idx" ON "candidates" USING btree ("set_id");--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_owner_key_idx" ON "command_receipts" USING btree ("owner_id","key");--> statement-breakpoint
CREATE INDEX "feedback_session_idx" ON "feedback_events" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_owner_key_idx" ON "feedback_events" USING btree ("owner_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "project_owner_idx" ON "projects" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "session_project_idx" ON "sessions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "task_session_idx" ON "tasks" USING btree ("session_id");