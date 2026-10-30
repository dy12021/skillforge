CREATE TABLE "privacy_erasures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"project_id" uuid,
	"target_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"content_digest" text NOT NULL,
	"counts_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "preference_rules" ADD COLUMN "evidence_erased" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "privacy_erasures" ADD CONSTRAINT "privacy_erasures_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "privacy_erasure_owner_idx" ON "privacy_erasures" USING btree ("owner_id","created_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION skillforge_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE erase_owner text; authorized boolean := false;
BEGIN
  erase_owner := current_setting('skillforge.erasure_owner', true);
  IF TG_OP = 'DELETE' AND erase_owner IS NOT NULL AND erase_owner <> '' THEN
    IF TG_TABLE_NAME IN ('feedback_events', 'pattern_reviews', 'rule_history') THEN
      authorized := OLD.owner_id::text = erase_owner;
    ELSIF TG_TABLE_NAME = 'document_versions' THEN
      SELECT EXISTS(SELECT 1 FROM public.sessions s WHERE s.id = OLD.session_id AND s.owner_id::text = erase_owner) INTO authorized;
    ELSIF TG_TABLE_NAME = 'annotations' THEN
      SELECT EXISTS(SELECT 1 FROM public.document_versions d JOIN public.sessions s ON s.id = d.session_id WHERE d.id = OLD.document_version_id AND s.owner_id::text = erase_owner) INTO authorized;
    END IF;
    IF authorized THEN RETURN OLD; END IF;
  END IF;
  RAISE EXCEPTION 'SkillForge audit records and document versions are immutable outside explicit owner privacy erasure';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER privacy_erasure_immutable BEFORE UPDATE OR DELETE ON privacy_erasures FOR EACH ROW EXECUTE FUNCTION skillforge_reject_mutation();
