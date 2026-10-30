CREATE TABLE "revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"parent_version_id" uuid NOT NULL,
	"accepted_version_id" uuid,
	"job_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"status" text DEFAULT 'awaiting_generation' NOT NULL,
	"instruction" text NOT NULL,
	"selection_json" jsonb,
	"protected_json" jsonb NOT NULL,
	"suggested_text" text,
	"rationale" text,
	"semantic_warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model_details_json" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "session_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "job_type" text DEFAULT 'training' NOT NULL;--> statement-breakpoint
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_parent_version_id_document_versions_id_fk" FOREIGN KEY ("parent_version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_accepted_version_id_document_versions_id_fk" FOREIGN KEY ("accepted_version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "revision_session_idx" ON "revisions" USING btree ("session_id");--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
DROP INDEX IF EXISTS job_one_active_per_session;
--> statement-breakpoint
CREATE UNIQUE INDEX job_one_active_per_session ON jobs(session_id) WHERE job_type='training' AND status IN ('awaiting_agent','queued','running');
--> statement-breakpoint
