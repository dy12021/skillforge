CREATE TABLE "skill_builds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"skill_type" text NOT NULL,
	"semantic_version" text NOT NULL,
	"content_hash" text NOT NULL,
	"zip_hash" text NOT NULL,
	"storage_key" text NOT NULL,
	"rules_snapshot" jsonb NOT NULL,
	"files_json" jsonb NOT NULL,
	"validation_report" jsonb NOT NULL,
	"generator_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "skill_builds" ADD CONSTRAINT "skill_builds_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "skill_build_version_idx" ON "skill_builds" USING btree ("owner_id","project_id","skill_type","semantic_version");
--> statement-breakpoint
CREATE TRIGGER skill_build_immutable BEFORE UPDATE OR DELETE ON skill_builds FOR EACH ROW EXECUTE FUNCTION skillforge_reject_mutation();
