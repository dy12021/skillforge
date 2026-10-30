CREATE FUNCTION skillforge_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'SkillForge audit records and document versions are immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER feedback_immutable BEFORE UPDATE OR DELETE ON feedback_events FOR EACH ROW EXECUTE FUNCTION skillforge_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER document_immutable BEFORE UPDATE OR DELETE ON document_versions FOR EACH ROW EXECUTE FUNCTION skillforge_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER annotation_immutable BEFORE UPDATE OR DELETE ON annotations FOR EACH ROW EXECUTE FUNCTION skillforge_reject_mutation();
--> statement-breakpoint
CREATE UNIQUE INDEX job_one_active_per_session ON jobs (session_id) WHERE status IN ('awaiting_agent','queued','running');
