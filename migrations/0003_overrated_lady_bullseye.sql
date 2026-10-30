CREATE TABLE "generated_topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"topic_json" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"model_details_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generated_topics" ADD CONSTRAINT "generated_topics_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_topics" ADD CONSTRAINT "generated_topics_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "topic_project_hash_idx" ON "generated_topics" USING btree ("owner_id","project_id","content_hash");