import { and, eq, desc, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, OWNER_ID, type Tx } from "./db";
import {
  preferenceRules,
  ruleHistory,
  feedbackEvents,
  sessions,
  tasks,
  candidates,
  candidateSets,
  patternReviews,
  jobs,
} from "./schema";
import {
  ruleConfig,
  scopePriority,
  scopeApplies,
  type RuleConfig,
  type DetectionContext,
} from "./rule-types";
import { getProject } from "./projects";
import { AppError, requireValue } from "./errors";
import {
  agentDetails,
  lockModelJob,
  modelDetails,
  finishModelJob,
  type ProviderProof,
} from "./model-jobs";
export async function validateRuleScope(tx: Tx, config: RuleConfig) {
  if (config.scope.project_id) {
    const project = await getProject(config.scope.project_id, tx);
    if (
      config.scope.domain !== "both" &&
      config.scope.domain !== project.domain
    )
      throw new AppError(
        400,
        "SCOPE_DOMAIN_MISMATCH",
        "项目规则的写作/对话范围必须与项目一致，或显式选择共享",
      );
  }
  if (config.scope.task_id) {
    const [task] = await tx
      .select({ task: tasks })
      .from(tasks)
      .innerJoin(sessions, eq(tasks.session_id, sessions.id))
      .where(
        and(
          eq(tasks.id, config.scope.task_id),
          eq(sessions.project_id, config.scope.project_id!),
          eq(sessions.owner_id, OWNER_ID),
        ),
      );
    requireValue(task, "任务不属于此项目");
  }
}
export const manualPreference = z
  .object({ config: ruleConfig, pattern_id: z.uuid().optional() })
  .strict();
async function history(
  tx: Tx,
  row: typeof preferenceRules.$inferSelect,
  event: string,
) {
  await tx.insert(ruleHistory).values({
    owner_id: OWNER_ID,
    actor_id: OWNER_ID,
    rule_id: row.id,
    version: row.version,
    event_type: event,
    snapshot_json: JSON.parse(JSON.stringify(row)),
  });
}
export async function proposeCorpusPreference(
  tx: Tx,
  config: RuleConfig,
  jobId: string,
  evidenceIds: string[],
  rationale: string,
  details: Record<string, unknown>,
) {
  await validateRuleScope(tx, config);
  const [row] = await tx
    .insert(preferenceRules)
    .values({
      owner_id: OWNER_ID,
      project_id: config.scope.project_id,
      job_id: jobId,
      source: "corpus",
      config_json: { ...config, positive_examples: [], negative_examples: [] },
      evidence_ids: evidenceIds,
      rationale,
      confidence_summary:
        "用户确认了此语料发现；规则仍待独立确认，未默认学习整份语料",
      model_details_json: details,
    })
    .returning();
  await history(tx, row, "rule_proposed_from_confirmed_corpus_discovery");
  return row;
}
export async function archiveCorpusRules(tx: Tx, jobIds: string[]) {
  if (!jobIds.length) return [];
  const rows = await tx
    .select()
    .from(preferenceRules)
    .where(
      and(
        eq(preferenceRules.owner_id, OWNER_ID),
        inArray(preferenceRules.job_id, jobIds),
      ),
    );
  for (const row of rows) {
    const [changed] = await tx
      .update(preferenceRules)
      .set({ status: "archived", version: row.version + 1 })
      .where(eq(preferenceRules.id, row.id))
      .returning();
    await history(tx, changed, "rule_archived_after_source_deletion");
  }
  return rows.map((r) => r.id);
}
export async function createPreference(
  tx: Tx,
  input: z.infer<typeof manualPreference>,
) {
  await validateRuleScope(tx, input.config);
  if (input.pattern_id) {
    const { linguisticPatterns } = await import("./schema");
    requireValue(
      await tx.query.linguisticPatterns.findFirst({
        where: and(
          eq(linguisticPatterns.id, input.pattern_id),
          eq(linguisticPatterns.owner_id, OWNER_ID),
        ),
      }),
    );
  }
  const [row] = await tx
    .insert(preferenceRules)
    .values({
      owner_id: OWNER_ID,
      project_id: input.config.scope.project_id,
      pattern_id: input.pattern_id,
      config_json: input.config,
      source: "manual",
      rationale: "用户手动提出，等待显式确认",
    })
    .returning();
  await history(tx, row, "rule_proposed");
  return row;
}
function overlap(a: RuleConfig, b: RuleConfig) {
  return (
    (a.scope.domain === "both" ||
      b.scope.domain === "both" ||
      a.scope.domain === b.scope.domain) &&
    (!a.scope.genre || !b.scope.genre || a.scope.genre === b.scope.genre) &&
    (!a.scope.project_id ||
      !b.scope.project_id ||
      a.scope.project_id === b.scope.project_id) &&
    (!a.scope.task_id ||
      !b.scope.task_id ||
      a.scope.task_id === b.scope.task_id)
  );
}
export function ruleConflicts(rows: (typeof preferenceRules.$inferSelect)[]) {
  const result: {
    left: string;
    right: string;
    same_level: boolean;
    reason: string;
    precedence: string;
  }[] = [];
  for (let i = 0; i < rows.length; i++)
    for (let j = i + 1; j < rows.length; j++) {
      const a = ruleConfig.parse(rows[i].config_json),
        b = ruleConfig.parse(rows[j].config_json);
      if (
        !["confirmed", "proposed"].includes(rows[i].status) ||
        !["confirmed", "proposed"].includes(rows[j].status) ||
        a.family !== b.family ||
        !overlap(a, b) ||
        a.instruction === b.instruction
      )
        continue;
      const same = scopePriority(a.scope) === scopePriority(b.scope);
      result.push({
        left: rows[i].id,
        right: rows[j].id,
        same_level: same,
        reason: `同一模式家族 ${a.family} 存在不同指导，请检查冲突`,
        precedence: same
          ? "需编辑范围/例外或显式停用其中一条"
          : scopePriority(a.scope) > scopePriority(b.scope)
            ? rows[i].id
            : rows[j].id,
      });
    }
  return result;
}
export async function listPreferences(projectId?: string) {
  if (projectId) await getProject(projectId);
  const all = await db
    .select()
    .from(preferenceRules)
    .where(eq(preferenceRules.owner_id, OWNER_ID))
    .orderBy(desc(preferenceRules.created_at));
  const rows = projectId
    ? all.filter((r) => !r.project_id || r.project_id === projectId)
    : all;
  return { rules: rows, conflicts: ruleConflicts(rows) };
}
export async function preferenceHistory(id: string) {
  requireValue(
    await db.query.preferenceRules.findFirst({
      where: and(
        eq(preferenceRules.id, id),
        eq(preferenceRules.owner_id, OWNER_ID),
      ),
    }),
  );
  return db
    .select()
    .from(ruleHistory)
    .where(and(eq(ruleHistory.rule_id, id), eq(ruleHistory.owner_id, OWNER_ID)))
    .orderBy(ruleHistory.version);
}
export const preferenceUpdate = z
  .object({
    expected_version: z.number().int().positive(),
    action: z.enum(["edit", "confirm", "reject", "archive", "reopen"]),
    config: ruleConfig.optional(),
    resolve_conflict_ids: z.array(z.uuid()).max(20).default([]),
  })
  .strict();
export async function changePreference(
  tx: Tx,
  id: string,
  input: z.infer<typeof preferenceUpdate>,
) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${OWNER_ID + ":preferences"}))`,
  );
  const [row] = await tx
    .select()
    .from(preferenceRules)
    .where(
      and(eq(preferenceRules.id, id), eq(preferenceRules.owner_id, OWNER_ID)),
    )
    .for("update");
  requireValue(row);
  if (row.evidence_erased && !["archive", "reject"].includes(input.action))
    throw new AppError(
      410,
      "EVIDENCE_ERASED",
      "此规则来源已永久清除，不能恢复或编辑原始内容；可另建明确的手动规则",
    );
  if (row.version !== input.expected_version)
    throw new AppError(409, "VERSION_CONFLICT", "规则版本已改变，请刷新");
  const config = input.config ?? ruleConfig.parse(row.config_json);
  await validateRuleScope(tx, config);
  if (input.action === "edit" && !input.config)
    throw new AppError(400, "CONFIG_REQUIRED", "编辑需要完整规则配置");
  const status =
    input.action === "confirm"
      ? "confirmed"
      : input.action === "archive"
        ? "archived"
        : input.action === "reject"
          ? "rejected"
          : "proposed";
  if (status === "confirmed") {
    if (row.source === "corpus") {
      const { corpusAssets, corpusSegments } = await import("./schema");
      const sourceJob = row.job_id
        ? await tx.query.jobs.findFirst({
            where: and(eq(jobs.id, row.job_id), eq(jobs.owner_id, OWNER_ID)),
          })
        : undefined;
      const assetId = sourceJob?.payload.asset_id;
      const asset =
        typeof assetId === "string"
          ? await tx.query.corpusAssets.findFirst({
              where: and(
                eq(corpusAssets.id, assetId),
                eq(corpusAssets.owner_id, OWNER_ID),
              ),
            })
          : undefined;
      if (!asset || asset.deleted_at)
        throw new AppError(
          409,
          "SOURCE_DELETED",
          "语料来源已删除，不能重新确认派生规则",
        );
      const segments = await tx
        .select()
        .from(corpusSegments)
        .where(
          and(
            eq(corpusSegments.asset_id, asset.id),
            inArray(corpusSegments.id, row.evidence_ids),
          ),
        );
      if (segments.length !== row.evidence_ids.length)
        throw new AppError(409, "SOURCE_DELETED", "语料证据不完整，不能确认");
    }
    if (row.source !== "manual" && row.source !== "corpus" && row.project_id) {
      const active = new Set(
        (
          await activeFeedbackEvidence(tx, row.project_id, [
            ...row.evidence_ids,
            ...row.counter_evidence_ids,
          ])
        ).map((e) => e.id),
      );
      if (row.evidence_ids.some((e) => !active.has(e)))
        throw new AppError(
          409,
          "EVIDENCE_WITHDRAWN",
          "来源反馈已撤销，请重新提议或创建明确的手动规则",
        );
    }
    const existing = await tx
      .select()
      .from(preferenceRules)
      .where(
        and(
          eq(preferenceRules.owner_id, OWNER_ID),
          eq(preferenceRules.status, "confirmed"),
        ),
      );
    const conflicts = ruleConflicts([
      { ...row, config_json: config, status },
      ...existing.filter((r) => r.id !== id),
    ]).filter((c) => c.same_level && (c.left === id || c.right === id));
    const required = conflicts.map((c) => (c.left === id ? c.right : c.left));
    if (required.some((i) => !input.resolve_conflict_ids.includes(i)))
      throw new AppError(
        409,
        "RULE_CONFLICT",
        "同层级规则存在潜在冲突；请缩小范围或明确选择停用冲突规则",
      );
    if (input.resolve_conflict_ids.some((i) => !required.includes(i)))
      throw new AppError(400, "UNRELATED_CONFLICT", "不能停用未列为冲突的规则");
    for (const other of existing.filter((r) => required.includes(r.id))) {
      const [archived] = await tx
        .update(preferenceRules)
        .set({ status: "archived", version: other.version + 1 })
        .where(eq(preferenceRules.id, other.id))
        .returning();
      await history(tx, archived, "rule_archived_by_explicit_resolution");
    }
  } else if (input.resolve_conflict_ids.length)
    throw new AppError(
      400,
      "UNEXPECTED_RESOLUTION",
      "只有确认规则时可以处理冲突",
    );
  const [updated] = await tx
    .update(preferenceRules)
    .set({
      config_json: config,
      project_id: config.scope.project_id,
      status,
      version: row.version + 1,
    })
    .where(eq(preferenceRules.id, id))
    .returning();
  await history(tx, updated, `rule_${input.action}`);
  return updated;
}
export async function activeFeedbackEvidence(
  tx: Tx,
  projectId: string,
  evidenceIds?: string[],
) {
  await getProject(projectId, tx);
  const raw = await tx
    .select({ event: feedbackEvents })
    .from(feedbackEvents)
    .innerJoin(sessions, eq(feedbackEvents.session_id, sessions.id))
    .where(
      and(
        eq(sessions.project_id, projectId),
        eq(feedbackEvents.owner_id, OWNER_ID),
      ),
    )
    .orderBy(desc(feedbackEvents.created_at));
  const undone = new Set(
    raw
      .filter((r) => r.event.event_type === "feedback_undone")
      .map((r) => String(r.event.payload_json.event_id)),
  );
  const active = raw
    .map((r) => r.event)
    .filter((e) => e.event_type !== "feedback_undone" && !undone.has(e.id));
  const selected = evidenceIds
    ? active.filter((e) => evidenceIds.includes(e.id))
    : active.slice(0, 40);
  const sessionIds = [...new Set(selected.map((e) => e.session_id))];
  const texts = sessionIds.length
    ? await tx
        .select({ id: candidates.id, text: candidates.text, task_id: tasks.id })
        .from(candidates)
        .innerJoin(candidateSets, eq(candidates.set_id, candidateSets.id))
        .innerJoin(tasks, eq(candidateSets.task_id, tasks.id))
        .where(inArray(tasks.session_id, sessionIds))
    : [];
  const reviews = await tx
    .select()
    .from(patternReviews)
    .where(
      and(
        eq(patternReviews.owner_id, OWNER_ID),
        eq(patternReviews.project_id, projectId),
        ...(evidenceIds ? [inArray(patternReviews.id, evidenceIds)] : []),
      ),
    )
    .orderBy(desc(patternReviews.created_at))
    .limit(evidenceIds ? 100 : 20);
  return [
    ...selected.map((e) => ({
      id: e.id,
      event_type: e.event_type,
      payload: e.payload_json,
      context: texts
        .filter((t) => t.task_id === e.task_id)
        .map((t) => ({ id: t.id, text: t.text })),
      source: "feedback",
    })),
    ...reviews.map((e) => ({
      id: e.id,
      event_type: e.event_type,
      payload: e.payload_json,
      context: [],
      source: "pattern_review",
    })),
  ];
}
export const preferenceRequest = z
  .object({
    project_id: z.uuid(),
    generation_source: z.enum(["agent", "provider"]).default("agent"),
  })
  .strict();
export const preferenceProposal = z
  .object({
    config: ruleConfig,
    evidence_ids: z.array(z.uuid()).min(2).max(40),
    counter_evidence_ids: z.array(z.uuid()).max(40).default([]),
    rationale: z.string().min(1).max(3000),
    confidence_summary: z.string().min(1).max(1000),
  })
  .strict();
export const preferenceOutput = z
  .object({
    proposals: z.array(preferenceProposal).min(1).max(8),
    model_details: agentDetails,
  })
  .strict();
export async function requestPreferences(
  tx: Tx,
  input: z.infer<typeof preferenceRequest>,
) {
  const project = await getProject(input.project_id, tx),
    evidence = await activeFeedbackEvidence(tx, project.id);
  if (evidence.length < 2)
    throw new AppError(
      409,
      "INSUFFICIENT_EVIDENCE",
      "至少需要两条未撤销反馈；系统不会捏造偏好证据",
    );
  const [job] = await tx
    .insert(jobs)
    .values({
      owner_id: OWNER_ID,
      project_id: project.id,
      job_type: "preference",
      status: input.generation_source === "agent" ? "awaiting_agent" : "queued",
      payload: {
        ...input,
        domain: project.domain,
        evidence,
        output_contract:
          "proposals: [{config,evidence_ids(min 2 distinct),counter_evidence_ids,rationale,confidence_summary}], model_details；只能 proposed；禁止从多选推断排名或从全拒绝创造正例；反例与边界如实说明",
      },
    })
    .returning();
  return { job, job_id: job.id };
}
export async function completePreferences(
  tx: Tx,
  id: string,
  raw: unknown,
  proof?: ProviderProof,
) {
  const job = await lockModelJob(tx, id, "preference", proof),
    output = preferenceOutput.parse(raw),
    projectId = requireValue(job.project_id),
    active = await activeFeedbackEvidence(
      tx,
      projectId,
      (job.payload.evidence as { id: string }[]).map((e) => e.id),
    );
  const requestIds = new Set(
      (job.payload.evidence as { id: string }[]).map((e) => e.id),
    ),
    activeIds = new Set(active.map((e) => e.id));
  const created = [];
  for (const proposal of output.proposals) {
    const ids = [...new Set(proposal.evidence_ids)];
    if (
      ids.length < 2 ||
      [...ids, ...proposal.counter_evidence_ids].some(
        (e) => !requestIds.has(e) || !activeIds.has(e),
      )
    )
      throw new AppError(
        400,
        "INVALID_EVIDENCE",
        "提议必须引用任务中至少两条不同、仍有效的证据，不能引用撤销或虚构证据",
      );
    if (
      proposal.config.scope.level !== "project" ||
      proposal.config.scope.project_id !== projectId ||
      proposal.config.scope.domain !== job.payload.domain
    )
      throw new AppError(
        400,
        "PROPOSAL_SCOPE",
        "模型提议仅限本项目本领域；共享或全局范围须由用户显式编辑",
      );
    await validateRuleScope(tx, proposal.config);
    const [row] = await tx
      .insert(preferenceRules)
      .values({
        owner_id: OWNER_ID,
        project_id: projectId,
        job_id: id,
        config_json: proposal.config,
        status: "proposed",
        source: proof ? "provider" : "agent",
        evidence_ids: ids,
        counter_evidence_ids: proposal.counter_evidence_ids,
        rationale: proposal.rationale,
        confidence_summary: proposal.confidence_summary,
        model_details_json: modelDetails(output.model_details, proof),
      })
      .returning();
    await history(tx, row, "rule_proposed");
    created.push(row.id);
  }
  return finishModelJob(tx, id, { rule_ids: created });
}
export async function effectiveRules(
  context: DetectionContext,
  tx: Tx | typeof db = db,
) {
  const rows = await tx
    .select()
    .from(preferenceRules)
    .where(
      and(
        eq(preferenceRules.owner_id, OWNER_ID),
        eq(preferenceRules.status, "confirmed"),
      ),
    );
  const applicable = rows
    .map((r) => ({ ...r, config: ruleConfig.parse(r.config_json) }))
    .filter((r) => scopeApplies(r.config.scope, context))
    .sort(
      (a, b) => scopePriority(b.config.scope) - scopePriority(a.config.scope),
    );
  return applicable.filter(
    (row) =>
      !applicable.some(
        (other) =>
          other.id !== row.id &&
          other.config.family === row.config.family &&
          other.config.instruction !== row.config.instruction &&
          scopePriority(other.config.scope) > scopePriority(row.config.scope),
      ),
  );
}
