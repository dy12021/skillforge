import { and, eq, isNull } from "drizzle-orm";
import { db, OWNER_ID } from "./db";
import * as s from "./schema";
import { readStored } from "./storage";
import {
  listEvaluations,
  getEvaluation,
  evaluationResults,
} from "./evaluations";
import { listPrivacyErasures } from "./privacy";
export async function exportWorkspace() {
  const assets = await db
    .select()
    .from(s.corpusAssets)
    .where(
      and(
        eq(s.corpusAssets.owner_id, OWNER_ID),
        isNull(s.corpusAssets.deleted_at),
      ),
    );
  const corpusFiles = [];
  for (const asset of assets)
    if (asset.storage_key)
      corpusFiles.push({
        asset_id: asset.id,
        filename: asset.filename,
        content_base64: (await readStored(asset.storage_key)).toString(
          "base64",
        ),
      });
  return {
    format: "skillforge-export-v1",
    privacy_erasures: await listPrivacyErasures(),
    exported_at: new Date().toISOString(),
    owner_id: OWNER_ID,
    notice:
      "包含私人材料，请妥善保存；不包含模型密钥。已删除语料不恢复，已导出 Skill 无法自动撤回。",
    evaluations: await Promise.all(
      (await listEvaluations()).map(async (run) => ({
        state: await getEvaluation(run.id),
        results: await evaluationResults(run.id),
      })),
    ),
    workspace: await db
      .select()
      .from(s.workspaces)
      .where(eq(s.workspaces.owner_id, OWNER_ID)),
    projects: await db
      .select()
      .from(s.projects)
      .where(eq(s.projects.owner_id, OWNER_ID)),
    sessions: await db
      .select()
      .from(s.sessions)
      .where(eq(s.sessions.owner_id, OWNER_ID)),
    tasks: await db
      .select({ task: s.tasks })
      .from(s.tasks)
      .innerJoin(s.sessions, eq(s.tasks.session_id, s.sessions.id))
      .where(eq(s.sessions.owner_id, OWNER_ID)),
    candidate_sets: await db
      .select({ set: s.candidateSets })
      .from(s.candidateSets)
      .innerJoin(s.tasks, eq(s.candidateSets.task_id, s.tasks.id))
      .innerJoin(s.sessions, eq(s.tasks.session_id, s.sessions.id))
      .where(eq(s.sessions.owner_id, OWNER_ID)),
    candidates: await db
      .select({ candidate: s.candidates })
      .from(s.candidates)
      .innerJoin(
        s.documentVersions,
        eq(s.candidates.document_version_id, s.documentVersions.id),
      )
      .innerJoin(s.sessions, eq(s.documentVersions.session_id, s.sessions.id))
      .where(eq(s.sessions.owner_id, OWNER_ID)),
    document_versions: await db
      .select({ document: s.documentVersions })
      .from(s.documentVersions)
      .innerJoin(s.sessions, eq(s.documentVersions.session_id, s.sessions.id))
      .where(eq(s.sessions.owner_id, OWNER_ID)),
    feedback_events: await db
      .select()
      .from(s.feedbackEvents)
      .where(eq(s.feedbackEvents.owner_id, OWNER_ID)),
    annotations: await db
      .select()
      .from(s.annotations)
      .where(eq(s.annotations.author_id, OWNER_ID)),
    revisions: await db
      .select()
      .from(s.revisions)
      .where(eq(s.revisions.owner_id, OWNER_ID)),
    patterns: await db
      .select()
      .from(s.linguisticPatterns)
      .where(eq(s.linguisticPatterns.owner_id, OWNER_ID)),
    pattern_reviews: await db
      .select()
      .from(s.patternReviews)
      .where(eq(s.patternReviews.owner_id, OWNER_ID)),
    preferences: await db
      .select()
      .from(s.preferenceRules)
      .where(eq(s.preferenceRules.owner_id, OWNER_ID)),
    rule_history: await db
      .select()
      .from(s.ruleHistory)
      .where(eq(s.ruleHistory.owner_id, OWNER_ID)),
    corpus_assets: assets.map((a) => ({ ...a, storage_key: undefined })),
    corpus_files: corpusFiles,
    corpus_segments: await db
      .select()
      .from(s.corpusSegments)
      .where(eq(s.corpusSegments.owner_id, OWNER_ID)),
    corpus_discoveries: await db
      .select()
      .from(s.corpusDiscoveries)
      .where(eq(s.corpusDiscoveries.owner_id, OWNER_ID)),
    skill_builds: (
      await db
        .select()
        .from(s.skillBuilds)
        .where(eq(s.skillBuilds.owner_id, OWNER_ID))
    ).map((b) => ({ ...b, storage_key: undefined })),
  };
}
