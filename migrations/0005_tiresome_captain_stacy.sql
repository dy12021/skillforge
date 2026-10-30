CREATE TABLE "linguistic_patterns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"config_json" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pattern_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"pattern_id" uuid,
	"project_id" uuid,
	"event_type" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "preference_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"project_id" uuid,
	"pattern_id" uuid,
	"job_id" uuid,
	"config_json" jsonb NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"source" text NOT NULL,
	"evidence_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"counter_evidence_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rationale" text DEFAULT '' NOT NULL,
	"confidence_summary" text DEFAULT '等待用户复核' NOT NULL,
	"model_details_json" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rule_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"event_type" text NOT NULL,
	"snapshot_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pattern_reviews" ADD CONSTRAINT "pattern_reviews_pattern_id_linguistic_patterns_id_fk" FOREIGN KEY ("pattern_id") REFERENCES "public"."linguistic_patterns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pattern_reviews" ADD CONSTRAINT "pattern_reviews_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preference_rules" ADD CONSTRAINT "preference_rules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preference_rules" ADD CONSTRAINT "preference_rules_pattern_id_linguistic_patterns_id_fk" FOREIGN KEY ("pattern_id") REFERENCES "public"."linguistic_patterns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preference_rules" ADD CONSTRAINT "preference_rules_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_history" ADD CONSTRAINT "rule_history_rule_id_preference_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."preference_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "patterns_owner_idx" ON "linguistic_patterns" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "pattern_review_owner_idx" ON "pattern_reviews" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "preference_owner_idx" ON "preference_rules" USING btree ("owner_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rule_history_version_idx" ON "rule_history" USING btree ("rule_id","version");
--> statement-breakpoint
CREATE TRIGGER pattern_review_immutable BEFORE UPDATE OR DELETE ON pattern_reviews FOR EACH ROW EXECUTE FUNCTION skillforge_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER rule_history_immutable BEFORE UPDATE OR DELETE ON rule_history FOR EACH ROW EXECUTE FUNCTION skillforge_reject_mutation();
