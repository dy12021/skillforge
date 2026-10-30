CREATE TABLE "evaluation_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"left_text" text NOT NULL,
	"right_text" text NOT NULL,
	"left_source" text NOT NULL,
	"model_details_json" jsonb NOT NULL,
	"analysis_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evaluation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"build_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"test_run" boolean DEFAULT false NOT NULL,
	"holdout_source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evaluation_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"prompt" text NOT NULL,
	"constraints_json" jsonb NOT NULL,
	"prompt_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evaluation_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"vote" text NOT NULL,
	"origin" text NOT NULL,
	"comment" text NOT NULL,
	"semantic_review" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "evaluation_items" ADD CONSTRAINT "evaluation_items_run_id_evaluation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."evaluation_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_items" ADD CONSTRAINT "evaluation_items_task_id_evaluation_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."evaluation_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_runs" ADD CONSTRAINT "evaluation_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_runs" ADD CONSTRAINT "evaluation_runs_build_id_skill_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."skill_builds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_runs" ADD CONSTRAINT "evaluation_runs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_tasks" ADD CONSTRAINT "evaluation_tasks_run_id_evaluation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."evaluation_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_tasks" ADD CONSTRAINT "evaluation_tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_votes" ADD CONSTRAINT "evaluation_votes_run_id_evaluation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."evaluation_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_votes" ADD CONSTRAINT "evaluation_votes_item_id_evaluation_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."evaluation_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "evaluation_item_task_idx" ON "evaluation_items" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "evaluation_project_idx" ON "evaluation_runs" USING btree ("owner_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "evaluation_task_position_idx" ON "evaluation_tasks" USING btree ("run_id","position");--> statement-breakpoint
CREATE INDEX "holdout_prompt_idx" ON "evaluation_tasks" USING btree ("owner_id","project_id","prompt_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "evaluation_vote_item_idx" ON "evaluation_votes" USING btree ("owner_id","item_id");
--> statement-breakpoint
CREATE TRIGGER evaluation_task_immutable BEFORE UPDATE OR DELETE ON evaluation_tasks FOR EACH ROW EXECUTE FUNCTION skillforge_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER evaluation_item_immutable BEFORE UPDATE OR DELETE ON evaluation_items FOR EACH ROW EXECUTE FUNCTION skillforge_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER evaluation_vote_immutable BEFORE UPDATE OR DELETE ON evaluation_votes FOR EACH ROW EXECUTE FUNCTION skillforge_reject_mutation();
