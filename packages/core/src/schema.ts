import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  boolean,
  index,
  uniqueIndex,
  check,
  foreignKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
const created = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
export const workspaces = pgTable("workspaces", {
  id: uuid().primaryKey().defaultRandom(),
  owner_id: uuid().notNull(),
  name: text().notNull(),
  version: integer().notNull().default(1),
  created_at: created(),
});
export const projects = pgTable(
  "projects",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspace_id: uuid()
      .notNull()
      .references(() => workspaces.id),
    owner_id: uuid().notNull(),
    name: text().notNull(),
    domain: text({ enum: ["writing", "dialogue"] }).notNull(),
    genre: text().notNull().default("general"),
    settings_json: jsonb()
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    version: integer().notNull().default(1),
    archived: boolean().notNull().default(false),
    created_at: created(),
  },
  (t) => [
    index("project_owner_idx").on(t.owner_id),
    check("project_domain", sql`${t.domain} IN ('writing','dialogue')`),
  ],
);
export const sessions = pgTable(
  "sessions",
  {
    id: uuid().primaryKey().defaultRandom(),
    project_id: uuid()
      .notNull()
      .references(() => projects.id),
    owner_id: uuid().notNull(),
    mode: text({ enum: ["writing", "dialogue"] }).notNull(),
    state: text({
      enum: ["awaiting_generation", "comparing", "feedback_saved", "completed"],
    })
      .notNull()
      .default("awaiting_generation"),
    version: integer().notNull().default(1),
    created_at: created(),
  },
  (t) => [index("session_project_idx").on(t.project_id)],
);
export const tasks = pgTable(
  "tasks",
  {
    id: uuid().primaryKey().defaultRandom(),
    session_id: uuid()
      .notNull()
      .references(() => sessions.id),
    source: text({ enum: ["auto", "manual", "corpus-derived"] }).notNull(),
    title: text().notNull(),
    prompt: text().notNull(),
    genre: text().notNull(),
    granularity: text().notNull(),
    target_dimension: text().notNull(),
    difficulty: text().notNull().default("normal"),
    constraints_json: jsonb().$type<string[]>().notNull().default([]),
    generation_id: text(),
    prompt_version: text().notNull().default("training-v1"),
    created_at: created(),
  },
  (t) => [index("task_session_idx").on(t.session_id)],
);
export const jobs = pgTable(
  "jobs",
  {
    id: uuid().primaryKey().defaultRandom(),
    session_id: uuid().references(() => sessions.id),
    project_id: uuid().references(() => projects.id),
    job_type: text({
      enum: [
        "training",
        "topic",
        "revision",
        "preference",
        "pattern_context",
        "corpus_extraction",
        "evaluation",
      ],
    })
      .notNull()
      .default("training"),
    owner_id: uuid().notNull(),
    status: text({
      enum: [
        "awaiting_agent",
        "queued",
        "running",
        "succeeded",
        "failed",
        "cancelled",
      ],
    }).notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    result: jsonb().$type<Record<string, unknown>>(),
    attempts: integer().notNull().default(0),
    error_code: text(),
    lease_until: timestamp({ withTimezone: true }),
    lease_token: uuid(),
    created_at: created(),
    updated_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("jobs_status_idx").on(t.status)],
);
export const candidateSets = pgTable(
  "candidate_sets",
  {
    id: uuid().primaryKey().defaultRandom(),
    task_id: uuid()
      .notNull()
      .references(() => tasks.id),
    job_id: uuid()
      .notNull()
      .references(() => jobs.id),
    model_provider: text().notNull(),
    generation_strategy: text().notNull(),
    prompt_version: text().notNull(),
    shuffled_order_json: jsonb().$type<string[]>().notNull(),
    created_at: created(),
  },
  (t) => [uniqueIndex("candidate_set_job_idx").on(t.job_id)],
);
export const documentVersions = pgTable(
  "document_versions",
  {
    id: uuid().primaryKey().defaultRandom(),
    session_id: uuid()
      .notNull()
      .references(() => sessions.id),
    parent_version_id: uuid(),
    content_text: text().notNull(),
    content_json: jsonb().$type<Record<string, unknown>>().notNull(),
    revision_source: text().notNull(),
    created_at: created(),
  },
  (t) => [
    foreignKey({
      columns: [t.parent_version_id],
      foreignColumns: [t.id],
      name: "document_parent_fk",
    }),
  ],
);
export const candidates = pgTable(
  "candidates",
  {
    id: uuid().primaryKey().defaultRandom(),
    set_id: uuid()
      .notNull()
      .references(() => candidateSets.id),
    document_version_id: uuid()
      .notNull()
      .references(() => documentVersions.id),
    text: text().notNull(),
    position: integer().notNull(),
    model_details_json: jsonb().$type<Record<string, unknown>>().notNull(),
    created_at: created(),
  },
  (t) => [index("candidate_set_idx").on(t.set_id)],
);
export const feedbackEvents = pgTable(
  "feedback_events",
  {
    id: uuid().primaryKey().defaultRandom(),
    owner_id: uuid().notNull(),
    session_id: uuid()
      .notNull()
      .references(() => sessions.id),
    task_id: uuid()
      .notNull()
      .references(() => tasks.id),
    event_type: text().notNull(),
    payload_json: jsonb().$type<Record<string, unknown>>().notNull(),
    idempotency_key: text().notNull(),
    created_at: created(),
  },
  (t) => [
    index("feedback_session_idx").on(t.session_id, t.created_at),
    uniqueIndex("feedback_owner_key_idx").on(t.owner_id, t.idempotency_key),
  ],
);
export const annotations = pgTable(
  "annotations",
  {
    id: uuid().primaryKey().defaultRandom(),
    document_version_id: uuid()
      .notNull()
      .references(() => documentVersions.id),
    block_id: text().notNull(),
    start_utf16: integer().notNull(),
    end_utf16: integer().notNull(),
    exact_quote: text().notNull(),
    quote_hash: text().notNull(),
    context_before: text().notNull(),
    context_after: text().notNull(),
    label: text().notNull(),
    comment: text().notNull(),
    human_rewrite: text(),
    author_id: uuid().notNull().default("00000000-0000-4000-8000-000000000001"),
    reanchored_from_id: uuid(),
    created_at: created(),
  },
  (t) => [
    index("annotation_document_idx").on(t.document_version_id, t.block_id),
    foreignKey({
      columns: [t.reanchored_from_id],
      foreignColumns: [t.id],
      name: "annotation_reanchor_fk",
    }),
    check(
      "annotation_offsets",
      sql`${t.start_utf16} >= 0 AND ${t.end_utf16} > ${t.start_utf16}`,
    ),
  ],
);
export const commandReceipts = pgTable(
  "command_receipts",
  {
    id: uuid().primaryKey().defaultRandom(),
    owner_id: uuid().notNull(),
    key: text().notNull(),
    fingerprint: text().notNull(),
    response: jsonb().notNull(),
    created_at: created(),
  },
  (t) => [uniqueIndex("receipt_owner_key_idx").on(t.owner_id, t.key)],
);

export const revisions = pgTable(
  "revisions",
  {
    id: uuid().primaryKey().defaultRandom(),
    owner_id: uuid().notNull(),
    session_id: uuid()
      .notNull()
      .references(() => sessions.id),
    parent_version_id: uuid()
      .notNull()
      .references(() => documentVersions.id),
    accepted_version_id: uuid().references(() => documentVersions.id),
    job_id: uuid()
      .notNull()
      .references(() => jobs.id),
    operation: text({
      enum: ["revise_selection", "revise_document"],
    }).notNull(),
    status: text({
      enum: ["awaiting_generation", "pending", "accepted", "rejected"],
    })
      .notNull()
      .default("awaiting_generation"),
    instruction: text().notNull(),
    selection_json: jsonb().$type<Record<string, unknown>>(),
    protected_json: jsonb()
      .$type<
        { annotation_id: string; quote: string; start: number; end: number }[]
      >()
      .notNull(),
    suggested_text: text(),
    rationale: text(),
    semantic_warnings: jsonb().$type<string[]>().notNull().default([]),
    model_details_json: jsonb().$type<Record<string, unknown>>(),
    version: integer().notNull().default(1),
    created_at: created(),
  },
  (t) => [index("revision_session_idx").on(t.session_id)],
);

export const generatedTopics = pgTable(
  "generated_topics",
  {
    id: uuid().primaryKey().defaultRandom(),
    owner_id: uuid().notNull(),
    project_id: uuid()
      .notNull()
      .references(() => projects.id),
    job_id: uuid()
      .notNull()
      .references(() => jobs.id),
    topic_json: jsonb().$type<Record<string, unknown>>().notNull(),
    content_hash: text().notNull(),
    model_details_json: jsonb().$type<Record<string, unknown>>().notNull(),
    created_at: created(),
  },
  (t) => [
    uniqueIndex("topic_project_hash_idx").on(
      t.owner_id,
      t.project_id,
      t.content_hash,
    ),
  ],
);

export const linguisticPatterns = pgTable(
  "linguistic_patterns",
  {
    id: uuid().primaryKey().defaultRandom(),
    owner_id: uuid().notNull(),
    config_json: jsonb().$type<Record<string, unknown>>().notNull(),
    active: boolean().notNull().default(true),
    version: integer().notNull().default(1),
    created_at: created(),
  },
  (t) => [index("patterns_owner_idx").on(t.owner_id)],
);
export const patternReviews = pgTable(
  "pattern_reviews",
  {
    id: uuid().primaryKey().defaultRandom(),
    owner_id: uuid().notNull(),
    pattern_id: uuid().references(() => linguisticPatterns.id),
    project_id: uuid().references(() => projects.id),
    event_type: text({
      enum: [
        "pattern_false_positive",
        "pattern_confirmed",
        "pattern_exception",
      ],
    }).notNull(),
    payload_json: jsonb().$type<Record<string, unknown>>().notNull(),
    created_at: created(),
  },
  (t) => [index("pattern_review_owner_idx").on(t.owner_id)],
);
export const preferenceRules = pgTable(
  "preference_rules",
  {
    id: uuid().primaryKey().defaultRandom(),
    owner_id: uuid().notNull(),
    project_id: uuid().references(() => projects.id),
    pattern_id: uuid().references(() => linguisticPatterns.id),
    job_id: uuid().references(() => jobs.id),
    config_json: jsonb().$type<Record<string, unknown>>().notNull(),
    status: text({ enum: ["proposed", "confirmed", "rejected", "archived"] })
      .notNull()
      .default("proposed"),
    source: text({ enum: ["manual", "agent", "provider", "corpus"] }).notNull(),
    evidence_ids: jsonb().$type<string[]>().notNull().default([]),
    counter_evidence_ids: jsonb().$type<string[]>().notNull().default([]),
    evidence_erased: boolean().notNull().default(false),
    rationale: text().notNull().default(""),
    confidence_summary: text().notNull().default("等待用户复核"),
    model_details_json: jsonb().$type<Record<string, unknown>>(),
    version: integer().notNull().default(1),
    created_at: created(),
  },
  (t) => [index("preference_owner_idx").on(t.owner_id, t.project_id)],
);
export const ruleHistory = pgTable(
  "rule_history",
  {
    id: uuid().primaryKey().defaultRandom(),
    owner_id: uuid().notNull(),
    actor_id: uuid().notNull(),
    rule_id: uuid()
      .notNull()
      .references(() => preferenceRules.id),
    version: integer().notNull(),
    event_type: text().notNull(),
    snapshot_json: jsonb().$type<Record<string, unknown>>().notNull(),
    created_at: created(),
  },
  (t) => [uniqueIndex("rule_history_version_idx").on(t.rule_id, t.version)],
);

export const corpusAssets = pgTable(
  "corpus_assets",
  {
    id: uuid().primaryKey().defaultRandom(),
    owner_id: uuid().notNull(),
    project_id: uuid()
      .notNull()
      .references(() => projects.id),
    filename: text().notNull(),
    mime: text().notNull(),
    file_hash: text().notNull(),
    byte_size: integer().notNull(),
    storage_key: text(),
    source_name: text().notNull(),
    source_url: text(),
    license_confirmed: boolean().notNull(),
    purpose: text({
      enum: ["positive", "negative", "observational"],
    }).notNull(),
    language: text().notNull().default("zh"),
    allow_example_export: boolean().notNull().default(false),
    extraction_version: text().notNull().default("text-v1"),
    deleted_at: timestamp({ withTimezone: true }),
    version: integer().notNull().default(1),
    created_at: created(),
  },
  (t) => [index("corpus_owner_project_idx").on(t.owner_id, t.project_id)],
);
export const corpusSegments = pgTable(
  "corpus_segments",
  {
    id: uuid().primaryKey().defaultRandom(),
    asset_id: uuid()
      .notNull()
      .references(() => corpusAssets.id),
    owner_id: uuid().notNull(),
    position: integer().notNull(),
    original_text: text().notNull(),
    cleaned_text: text().notNull(),
    context_before: text().notNull(),
    context_after: text().notNull(),
    start_ms: integer(),
    end_ms: integer(),
    speaker_id: text(),
    purpose: text({
      enum: ["positive", "negative", "observational"],
    }).notNull(),
    version: integer().notNull().default(1),
    created_at: created(),
  },
  (t) => [uniqueIndex("segment_asset_position_idx").on(t.asset_id, t.position)],
);
export const corpusDiscoveries = pgTable(
  "corpus_discoveries",
  {
    id: uuid().primaryKey().defaultRandom(),
    owner_id: uuid().notNull(),
    asset_id: uuid()
      .notNull()
      .references(() => corpusAssets.id),
    job_id: uuid()
      .notNull()
      .references(() => jobs.id),
    evidence_json: jsonb()
      .$type<
        {
          segment_id: string;
          quote: string;
          version: number;
          purpose: string;
        }[]
      >()
      .notNull(),
    config_json: jsonb().$type<Record<string, unknown>>().notNull(),
    rationale: text().notNull(),
    status: text({ enum: ["proposed", "confirmed", "rejected"] })
      .notNull()
      .default("proposed"),
    rule_id: uuid().references(() => preferenceRules.id),
    model_details_json: jsonb().$type<Record<string, unknown>>().notNull(),
    version: integer().notNull().default(1),
    created_at: created(),
  },
  (t) => [index("corpus_discovery_asset_idx").on(t.asset_id)],
);

export const skillBuilds = pgTable(
  "skill_builds",
  {
    id: uuid().primaryKey().defaultRandom(),
    owner_id: uuid().notNull(),
    project_id: uuid()
      .notNull()
      .references(() => projects.id),
    skill_type: text({
      enum: [
        "personalized-writing",
        "personalized-dialogue",
        "language-naturalizer",
      ],
    }).notNull(),
    semantic_version: text().notNull(),
    content_hash: text().notNull(),
    zip_hash: text().notNull(),
    storage_key: text().notNull(),
    rules_snapshot: jsonb().$type<Record<string, unknown>[]>().notNull(),
    files_json: jsonb().$type<Record<string, string>>().notNull(),
    validation_report: jsonb().$type<Record<string, unknown>>().notNull(),
    generator_version: text().notNull(),
    created_at: created(),
  },
  (t) => [
    uniqueIndex("skill_build_version_idx").on(
      t.owner_id,
      t.project_id,
      t.skill_type,
      t.semantic_version,
    ),
  ],
);

export const evaluationRuns = pgTable(
  "evaluation_runs",
  {
    id: uuid().primaryKey().defaultRandom(),
    owner_id: uuid().notNull(),
    project_id: uuid()
      .notNull()
      .references(() => projects.id),
    build_id: uuid()
      .notNull()
      .references(() => skillBuilds.id),
    job_id: uuid()
      .notNull()
      .references(() => jobs.id),
    domain: text({ enum: ["writing", "dialogue"] }).notNull(),
    test_run: boolean().notNull().default(false),
    holdout_source: text().notNull(),
    created_at: created(),
  },
  (t) => [index("evaluation_project_idx").on(t.owner_id, t.project_id)],
);
export const evaluationTasks = pgTable(
  "evaluation_tasks",
  {
    id: uuid().primaryKey().defaultRandom(),
    owner_id: uuid().notNull(),
    run_id: uuid()
      .notNull()
      .references(() => evaluationRuns.id),
    project_id: uuid()
      .notNull()
      .references(() => projects.id),
    position: integer().notNull(),
    title: text().notNull(),
    prompt: text().notNull(),
    constraints_json: jsonb().$type<string[]>().notNull(),
    prompt_hash: text().notNull(),
    created_at: created(),
  },
  (t) => [
    uniqueIndex("evaluation_task_position_idx").on(t.run_id, t.position),
    index("holdout_prompt_idx").on(t.owner_id, t.project_id, t.prompt_hash),
  ],
);
export const evaluationItems = pgTable(
  "evaluation_items",
  {
    id: uuid().primaryKey().defaultRandom(),
    owner_id: uuid().notNull(),
    run_id: uuid()
      .notNull()
      .references(() => evaluationRuns.id),
    task_id: uuid()
      .notNull()
      .references(() => evaluationTasks.id),
    left_text: text().notNull(),
    right_text: text().notNull(),
    left_source: text({ enum: ["baseline", "personalized"] }).notNull(),
    model_details_json: jsonb().$type<Record<string, unknown>>().notNull(),
    analysis_json: jsonb().$type<Record<string, unknown>>().notNull(),
    created_at: created(),
  },
  (t) => [uniqueIndex("evaluation_item_task_idx").on(t.task_id)],
);
export const evaluationVotes = pgTable(
  "evaluation_votes",
  {
    id: uuid().primaryKey().defaultRandom(),
    owner_id: uuid().notNull(),
    actor_id: uuid().notNull(),
    run_id: uuid()
      .notNull()
      .references(() => evaluationRuns.id),
    item_id: uuid()
      .notNull()
      .references(() => evaluationItems.id),
    vote: text({ enum: ["left", "right", "tie", "both_bad"] }).notNull(),
    origin: text({ enum: ["human", "test"] }).notNull(),
    comment: text().notNull(),
    semantic_review: text({ enum: ["pass", "risk", "not_reviewed"] }).notNull(),
    created_at: created(),
  },
  (t) => [uniqueIndex("evaluation_vote_item_idx").on(t.owner_id, t.item_id)],
);
export const privacyErasures = pgTable(
  "privacy_erasures",
  {
    id: uuid().primaryKey().defaultRandom(),
    owner_id: uuid().notNull(),
    actor_id: uuid().notNull(),
    project_id: uuid().references(() => projects.id),
    target_id: uuid().notNull(),
    target_type: text({ enum: ["session", "pattern_review"] }).notNull(),
    content_digest: text().notNull(),
    counts_json: jsonb().$type<Record<string, number>>().notNull(),
    created_at: created(),
  },
  (t) => [index("privacy_erasure_owner_idx").on(t.owner_id, t.created_at)],
);
