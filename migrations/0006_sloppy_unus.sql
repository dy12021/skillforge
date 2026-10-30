CREATE TABLE "corpus_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"mime" text NOT NULL,
	"file_hash" text NOT NULL,
	"byte_size" integer NOT NULL,
	"storage_key" text,
	"source_name" text NOT NULL,
	"source_url" text,
	"license_confirmed" boolean NOT NULL,
	"purpose" text NOT NULL,
	"language" text DEFAULT 'zh' NOT NULL,
	"allow_example_export" boolean DEFAULT false NOT NULL,
	"extraction_version" text DEFAULT 'text-v1' NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corpus_discoveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"evidence_json" jsonb NOT NULL,
	"config_json" jsonb NOT NULL,
	"rationale" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"rule_id" uuid,
	"model_details_json" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corpus_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"original_text" text NOT NULL,
	"cleaned_text" text NOT NULL,
	"context_before" text NOT NULL,
	"context_after" text NOT NULL,
	"start_ms" integer,
	"end_ms" integer,
	"speaker_id" text,
	"purpose" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "corpus_assets" ADD CONSTRAINT "corpus_assets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corpus_discoveries" ADD CONSTRAINT "corpus_discoveries_asset_id_corpus_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."corpus_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corpus_discoveries" ADD CONSTRAINT "corpus_discoveries_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corpus_discoveries" ADD CONSTRAINT "corpus_discoveries_rule_id_preference_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."preference_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corpus_segments" ADD CONSTRAINT "corpus_segments_asset_id_corpus_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."corpus_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "corpus_owner_project_idx" ON "corpus_assets" USING btree ("owner_id","project_id");--> statement-breakpoint
CREATE INDEX "corpus_discovery_asset_idx" ON "corpus_discoveries" USING btree ("asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "segment_asset_position_idx" ON "corpus_segments" USING btree ("asset_id","position");