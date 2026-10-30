import { and, eq, inArray, desc, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { z } from "zod";
import { db, OWNER_ID, type Tx } from "./db";
import {
  sessions,
  tasks,
  candidateSets,
  candidates,
  documentVersions,
  annotations,
  feedbackEvents,
  revisions,
  jobs,
  preferenceRules,
  ruleHistory,
  commandReceipts,
  privacyErasures,
  patternReviews,
  skillBuilds,
} from "./schema";
import { AppError, requireValue } from "./errors";
import { ruleConfig } from "./rule-types";
import { promptHash } from "./holdouts";
export const eraseSessionInput = z
  .object({
    confirm: z.literal(true),
    expected_version: z.number().int().positive(),
  })
  .strict();
export const eraseReviewInput = z.object({ confirm: z.literal(true) }).strict();
async function eraseReceipts(tx: Tx, refs: string[]) {
  for (const ref of refs)
    await tx
      .update(commandReceipts)
      .set({ response: { redacted_after_deletion: true } })
      .where(
        and(
          eq(commandReceipts.owner_id, OWNER_ID),
          sql`position(${ref} in ${commandReceipts.response}::text)>0`,
        ),
      );
}
async function redactSourceRules(
  tx: Tx,
  rows: (typeof preferenceRules.$inferSelect)[],
) {
  for (const row of rows) {
    const prior = ruleConfig.parse(row.config_json),
      config = ruleConfig.parse({
        ...prior,
        title: "来源已删除的停用规则",
        instruction:
          "原始来源已由用户永久清除；此规则不再生效。需要新指导时请另建手动规则。",
        family: "erased-" + row.id,
        match_spec: { kind: "guidance" },
        positive_examples: [],
        negative_examples: [],
        rewrite_strategies: [],
      });
    await tx
      .delete(ruleHistory)
      .where(
        and(
          eq(ruleHistory.owner_id, OWNER_ID),
          eq(ruleHistory.rule_id, row.id),
        ),
      );
    const [changed] = await tx
      .update(preferenceRules)
      .set({
        config_json: config,
        status: "archived",
        evidence_ids: [],
        counter_evidence_ids: [],
        evidence_erased: true,
        rationale: "用户显式隐私清除，旧原文证据及历史文本已擦除",
        confidence_summary: "来源已清除，不能恢复为生效规则",
        model_details_json: null,
        version: row.version + 1,
      })
      .where(eq(preferenceRules.id, row.id))
      .returning();
    await tx.insert(ruleHistory).values({
      owner_id: OWNER_ID,
      actor_id: OWNER_ID,
      rule_id: row.id,
      version: changed.version,
      event_type: "rule_source_privacy_erased",
      snapshot_json: JSON.parse(JSON.stringify(changed)),
    });
  }
}
export async function eraseSession(
  tx: Tx,
  id: string,
  input: z.infer<typeof eraseSessionInput>,
) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${OWNER_ID + ":preferences"}))`,
  );
  const [session] = await tx
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, id), eq(sessions.owner_id, OWNER_ID)))
    .for("update");
  requireValue(session);
  if (session.version !== input.expected_version)
    throw new AppError(
      409,
      "VERSION_CONFLICT",
      "会话在确认期间已改变，请刷新清除预览",
    );
  const originalTasks = await tx
      .select()
      .from(tasks)
      .where(eq(tasks.session_id, id)),
    versions = await tx
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.session_id, id)),
    events = await tx
      .select()
      .from(feedbackEvents)
      .where(
        and(
          eq(feedbackEvents.owner_id, OWNER_ID),
          eq(feedbackEvents.session_id, id),
        ),
      ),
    spans = versions.length
      ? await tx
          .select()
          .from(annotations)
          .where(
            inArray(
              annotations.document_version_id,
              versions.map((v) => v.id),
            ),
          )
      : [],
    sets = originalTasks.length
      ? await tx
          .select()
          .from(candidateSets)
          .where(
            inArray(
              candidateSets.task_id,
              originalTasks.map((t) => t.id),
            ),
          )
      : [],
    texts = sets.length
      ? await tx
          .select()
          .from(candidates)
          .where(
            inArray(
              candidates.set_id,
              sets.map((s) => s.id),
            ),
          )
      : [],
    suggestions = await tx
      .select()
      .from(revisions)
      .where(eq(revisions.session_id, id));
  const refs = [
      id,
      ...originalTasks.map((t) => t.id),
      ...versions.map((v) => v.id),
      ...events.map((e) => e.id),
      ...spans.map((a) => a.id),
      ...sets.map((s) => s.id),
      ...texts.map((t) => t.id),
      ...suggestions.map((r) => r.id),
    ],
    allJobs = await tx
      .select()
      .from(jobs)
      .where(eq(jobs.owner_id, OWNER_ID))
      .orderBy(jobs.id)
      .for("update"),
    directJobs = allJobs.filter(
      (j) =>
        j.session_id === id ||
        refs.some((ref) => JSON.stringify(j.payload).includes(ref)),
    ),
    directJobIds = new Set(directJobs.map((j) => j.id)),
    allRules = await tx
      .select()
      .from(preferenceRules)
      .where(eq(preferenceRules.owner_id, OWNER_ID)),
    affected = allRules.filter(
      (r) =>
        (!!r.job_id && directJobIds.has(r.job_id)) ||
        [...r.evidence_ids, ...r.counter_evidence_ids].some((ref) =>
          refs.includes(ref),
        ) ||
        refs.includes(ruleConfig.parse(r.config_json).scope.task_id ?? ""),
    );
  const digest = createHash("sha256")
      .update(
        JSON.stringify({
          session,
          originalTasks,
          versions,
          events,
          spans,
          texts,
        }),
      )
      .digest("hex"),
    erasedRuleIds = new Set(affected.map((r) => r.id));
  await tx.execute(
    sql`SELECT set_config('skillforge.erasure_owner',${OWNER_ID},true)`,
  );
  await redactSourceRules(tx, affected);
  const hashes = new Set(originalTasks.map((t) => promptHash(t.prompt)));
  let redactedJobs = 0;
  for (const job of allJobs) {
    let payload = { ...job.payload },
      changed = false,
      direct = directJobIds.has(job.id);
    if (direct) {
      payload = { redacted_after_session_erasure: true, erased_session_id: id };
      changed = true;
    } else {
      if (
        job.project_id === session.project_id &&
        Array.isArray(payload.previous_topics)
      ) {
        const filtered = payload.previous_topics.filter(
          (t) =>
            !hashes.has(
              promptHash(
                typeof t === "string"
                  ? t
                  : String((t as { prompt?: string })?.prompt ?? ""),
              ),
            ),
        );
        if (filtered.length !== payload.previous_topics.length) {
          payload.previous_topics = filtered;
          changed = true;
        }
      }
      if (Array.isArray(payload.confirmed_rules)) {
        const filtered = payload.confirmed_rules.filter(
          (r) => !erasedRuleIds.has(String((r as { id?: string }).id)),
        );
        if (filtered.length !== payload.confirmed_rules.length) {
          payload.confirmed_rules = filtered;
          changed = true;
        }
      }
      if (
        job.job_type === "evaluation" &&
        Array.isArray(payload.rules_snapshot) &&
        payload.rules_snapshot.some((r) =>
          erasedRuleIds.has(String((r as { id?: string }).id)),
        )
      ) {
        payload = {
          redacted_after_session_erasure: true,
          erased_session_id: id,
        };
        changed = true;
        direct = true;
      }
    }
    if (changed) {
      const pending = ["awaiting_agent", "queued", "running"].includes(
        job.status,
      );
      await tx
        .update(jobs)
        .set({
          payload,
          ...(job.session_id === id ? { session_id: null } : {}),
          ...(direct ? { result: null } : {}),
          ...(pending
            ? {
                status: "cancelled" as const,
                lease_token: null,
                lease_until: null,
                error_code: "SOURCE_ERASED",
              }
            : {}),
          updated_at: new Date(),
        })
        .where(eq(jobs.id, job.id));
      redactedJobs++;
      refs.push(job.id);
    }
  }
  await tx
    .delete(feedbackEvents)
    .where(
      and(
        eq(feedbackEvents.owner_id, OWNER_ID),
        eq(feedbackEvents.session_id, id),
      ),
    );
  await tx.delete(revisions).where(eq(revisions.session_id, id));
  if (versions.length) {
    await tx.delete(annotations).where(
      inArray(
        annotations.document_version_id,
        versions.map((v) => v.id),
      ),
    );
  }
  if (sets.length)
    await tx.delete(candidates).where(
      inArray(
        candidates.set_id,
        sets.map((s) => s.id),
      ),
    );
  if (originalTasks.length)
    await tx.delete(candidateSets).where(
      inArray(
        candidateSets.task_id,
        originalTasks.map((t) => t.id),
      ),
    );
  await tx.delete(documentVersions).where(eq(documentVersions.session_id, id));
  await tx.delete(tasks).where(eq(tasks.session_id, id));
  await tx
    .delete(sessions)
    .where(and(eq(sessions.id, id), eq(sessions.owner_id, OWNER_ID)));
  const linkedBuilds = await tx
      .select({ snapshot: skillBuilds.rules_snapshot })
      .from(skillBuilds)
      .where(eq(skillBuilds.owner_id, OWNER_ID)),
    historicalBuilds = linkedBuilds.filter((b) =>
      b.snapshot.some((r) => erasedRuleIds.has(String(r.id))),
    ).length;
  refs.push(...affected.map((r) => r.id));
  await eraseReceipts(tx, refs);
  const counts = {
    feedback_events: events.length,
    document_versions: versions.length,
    annotations: spans.length,
    candidates: texts.length,
    revisions: suggestions.length,
    redacted_jobs: redactedJobs,
    archived_rules: affected.length,
    historical_builds_retained: historicalBuilds,
  };
  const [record] = await tx
    .insert(privacyErasures)
    .values({
      owner_id: OWNER_ID,
      actor_id: OWNER_ID,
      project_id: session.project_id,
      target_id: id,
      target_type: "session",
      content_digest: digest,
      counts_json: counts,
    })
    .returning();
  return {
    erasure_id: record.id,
    erased_session_id: id,
    project_id: session.project_id,
    counts,
    content_digest: digest,
    notice:
      "本会话原始反馈、文档、批注与直接模型缓存已清除，来源规则及旧规则文本已停用/擦除。只保留不含原文的清除凭证。历史 Skill、独立评测和另行复制的语料/模式复核不会自动撤回；外部模型已收到的数据无法由本应用远程删除。",
  };
}
export async function erasePatternReview(tx: Tx, id: string) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${OWNER_ID + ":preferences"}))`,
  );
  const review = requireValue(
    await tx.query.patternReviews.findFirst({
      where: and(
        eq(patternReviews.id, id),
        eq(patternReviews.owner_id, OWNER_ID),
      ),
    }),
  );
  const allRules = await tx
    .select()
    .from(preferenceRules)
    .where(eq(preferenceRules.owner_id, OWNER_ID));
  await tx.execute(
    sql`SELECT set_config('skillforge.erasure_owner',${OWNER_ID},true)`,
  );
  await tx
    .delete(patternReviews)
    .where(
      and(eq(patternReviews.id, id), eq(patternReviews.owner_id, OWNER_ID)),
    );
  const related = await tx
    .select()
    .from(jobs)
    .where(eq(jobs.owner_id, OWNER_ID))
    .orderBy(jobs.id)
    .for("update");
  const directIds = new Set(
      related
        .filter((j) => JSON.stringify(j.payload).includes(id))
        .map((j) => j.id),
    ),
    affected = allRules.filter(
      (r) =>
        r.evidence_ids.includes(id) ||
        r.counter_evidence_ids.includes(id) ||
        (!!r.job_id && directIds.has(r.job_id)),
    ),
    ruleIds = new Set(affected.map((r) => r.id));
  await redactSourceRules(tx, affected);
  for (const job of related) {
    if (
      directIds.has(job.id) ||
      (job.job_type === "evaluation" &&
        JSON.stringify(job.payload.rules_snapshot ?? []).includes(id))
    )
      await tx
        .update(jobs)
        .set({
          payload: { redacted_after_deletion: true },
          result: null,
          status: job.status === "succeeded" ? "succeeded" : "cancelled",
          lease_token: null,
          lease_until: null,
        })
        .where(eq(jobs.id, job.id));
    else if (Array.isArray(job.payload.confirmed_rules)) {
      const filtered = job.payload.confirmed_rules.filter(
        (r) => !ruleIds.has(String((r as { id?: string }).id)),
      );
      if (filtered.length !== job.payload.confirmed_rules.length)
        await tx
          .update(jobs)
          .set({
            payload: { ...job.payload, confirmed_rules: filtered },
            ...(["queued", "running", "awaiting_agent"].includes(job.status)
              ? {
                  status: "cancelled" as const,
                  lease_token: null,
                  lease_until: null,
                  error_code: "SOURCE_ERASED",
                }
              : {}),
          })
          .where(eq(jobs.id, job.id));
    }
  }
  await eraseReceipts(tx, [id, ...directIds, ...ruleIds]);
  const [record] = await tx
    .insert(privacyErasures)
    .values({
      owner_id: OWNER_ID,
      actor_id: OWNER_ID,
      project_id: review.project_id,
      target_id: id,
      target_type: "pattern_review",
      content_digest: createHash("sha256")
        .update(JSON.stringify(review))
        .digest("hex"),
      counts_json: { pattern_reviews: 1, archived_rules: affected.length },
    })
    .returning();
  return {
    erasure_id: record.id,
    deleted_review_id: id,
    archived_rules: affected.length,
    notice:
      "复核原文、相关旧规则文本与直接模型输入缓存已清除，派生规则停用；历史成品与独立评测不自动撤回，只保留不含原文的清除凭证",
  };
}
export async function listPrivacyErasures() {
  return db
    .select()
    .from(privacyErasures)
    .where(eq(privacyErasures.owner_id, OWNER_ID))
    .orderBy(desc(privacyErasures.created_at));
}
