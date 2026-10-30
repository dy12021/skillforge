import { and, eq, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { randomInt } from "node:crypto";
import { db, OWNER_ID, type Tx } from "./db";
import { env } from "./config";
import {
  evaluationRuns,
  evaluationTasks,
  evaluationItems,
  evaluationVotes,
  skillBuilds,
  jobs,
  tasks,
  sessions,
  generatedTopics,
  patternReviews,
  revisions,
} from "./schema";
import { getProject } from "./projects";
import { AppError, requireValue } from "./errors";
import { promptHash, defaultHoldouts } from "./holdouts";
import { ruleConfig, detectionContext } from "./rule-types";
import { detectPatterns } from "./pattern-engine";
import { semanticWarnings } from "./semantic";
import {
  agentDetails,
  lockModelJob,
  finishModelJob,
  modelDetails,
  type ProviderProof,
} from "./model-jobs";
export const holdoutInput = z
  .object({
    title: z.string().min(1).max(200),
    prompt: z.string().min(1).max(12000),
    constraints: z.array(z.string().max(1000)).max(20).default([]),
  })
  .strict();
export const evaluationInput = z
  .object({
    build_id: z.uuid(),
    generation_source: z.enum(["agent", "provider"]).default("agent"),
    test_run: z.boolean().default(false),
    holdouts: z.array(holdoutInput).min(5).max(20).optional(),
  })
  .strict();
export const evaluationOutput = z
  .object({
    pairs: z
      .array(
        z
          .object({
            task_id: z.uuid(),
            baseline: z.string().min(1).max(20000),
            personalized: z.string().min(1).max(20000),
          })
          .strict(),
      )
      .min(5)
      .max(20),
    model_details: agentDetails,
  })
  .strict();
async function assertUntrained(tx: Tx, projectId: string, prompts: string[]) {
  const trained = await tx
      .select({ prompt: tasks.prompt })
      .from(tasks)
      .innerJoin(sessions, eq(tasks.session_id, sessions.id))
      .where(
        and(
          eq(sessions.owner_id, OWNER_ID),
          eq(sessions.project_id, projectId),
        ),
      ),
    topics = await tx
      .select()
      .from(generatedTopics)
      .where(
        and(
          eq(generatedTopics.owner_id, OWNER_ID),
          eq(generatedTopics.project_id, projectId),
        ),
      );
  const hashes = new Set([
    ...trained.map((t) => promptHash(t.prompt)),
    ...topics.map((t) => promptHash(String(t.topic_json.prompt))),
  ]);
  if (prompts.some((p) => hashes.has(promptHash(p))))
    throw new AppError(
      409,
      "HOLDOUT_LEAKAGE",
      "保留题与本项目训练题/已生成主题重复，请更换；不会把训练题冒充独立盲测",
    );
}
export async function createEvaluation(
  tx: Tx,
  input: z.infer<typeof evaluationInput>,
) {
  const build = requireValue(
      await tx.query.skillBuilds.findFirst({
        where: and(
          eq(skillBuilds.id, input.build_id),
          eq(skillBuilds.owner_id, OWNER_ID),
        ),
      }),
    ),
    project = await getProject(build.project_id, tx),
    domain =
      build.skill_type === "personalized-dialogue"
        ? "dialogue"
        : build.skill_type === "personalized-writing"
          ? "writing"
          : project.domain;
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${OWNER_ID + project.id + ":holdouts"}))`,
  );
  const holdouts = input.holdouts ?? defaultHoldouts(domain);
  if (
    new Set(holdouts.map((t) => promptHash(t.prompt))).size !== holdouts.length
  )
    throw new AppError(400, "DUPLICATE_HOLDOUT", "同次评测的保留题必须不同");
  await assertUntrained(
    tx,
    project.id,
    holdouts.map((t) => t.prompt),
  );
  const [job] = await tx
    .insert(jobs)
    .values({
      owner_id: OWNER_ID,
      project_id: project.id,
      job_type: "evaluation",
      status: input.generation_source === "agent" ? "awaiting_agent" : "queued",
      payload: { generation_source: input.generation_source },
    })
    .returning();
  const [run] = await tx
    .insert(evaluationRuns)
    .values({
      owner_id: OWNER_ID,
      project_id: project.id,
      build_id: build.id,
      job_id: job.id,
      domain,
      test_run:
        input.test_run || new URL(env.DATABASE_URL).pathname.endsWith("_test"),
      holdout_source: input.holdouts
        ? "user-supplied-untrained"
        : "curated-untrained-v1",
    })
    .returning();
  const fixed = await tx
    .insert(evaluationTasks)
    .values(
      holdouts.map((t, position) => ({
        owner_id: OWNER_ID,
        project_id: project.id,
        run_id: run.id,
        position,
        title: t.title,
        prompt: t.prompt,
        constraints_json: t.constraints,
        prompt_hash: promptHash(t.prompt),
      })),
    )
    .returning();
  const payload = {
    generation_source: input.generation_source,
    run_id: run.id,
    domain,
    build_id: build.id,
    build_version: build.semantic_version,
    build_hash: build.content_hash,
    skill_guidance: Object.fromEntries(
      Object.entries(build.files_json).filter(([path]) => path.endsWith(".md")),
    ),
    rules_snapshot: build.rules_snapshot,
    holdouts: fixed.map((t) => ({
      task_id: t.id,
      title: t.title,
      prompt: t.prompt,
      constraints: t.constraints_json,
    })),
    baseline_policy:
      "同题正常生成，不应用任何个人偏好 Skill；事实与任务约束保持一致",
    personalized_policy:
      "同题应用此构建的固定 Skill 文件和规则，当前事实/任务优先；禁止使用新训练反馈改写被测版本",
    output_contract:
      "pairs:[{task_id,baseline,personalized}],model_details；每个holdout恰好一对；不猜测左右映射，不自评获胜，不代替用户投票",
  };
  await tx.update(jobs).set({ payload }).where(eq(jobs.id, job.id));
  return {
    run,
    job_id: job.id,
    generation_request: payload,
    url: `/evaluations/${run.id}`,
  };
}
export async function completeEvaluation(
  tx: Tx,
  id: string,
  raw: unknown,
  proof?: ProviderProof,
) {
  const job = await lockModelJob(tx, id, "evaluation", proof),
    output = evaluationOutput.parse(raw),
    run = requireValue(
      await tx.query.evaluationRuns.findFirst({
        where: and(
          eq(evaluationRuns.job_id, id),
          eq(evaluationRuns.owner_id, OWNER_ID),
        ),
      }),
    ),
    holdouts = await tx
      .select()
      .from(evaluationTasks)
      .where(eq(evaluationTasks.run_id, run.id));
  if (job.payload.run_id !== run.id || job.payload.build_id !== run.build_id)
    throw new AppError(
      409,
      "EVALUATION_SNAPSHOT_MISMATCH",
      "评测任务与固定构建不匹配",
    );
  if (
    output.pairs.length !== holdouts.length ||
    new Set(output.pairs.map((p) => p.task_id)).size !== holdouts.length ||
    output.pairs.some((p) => !holdouts.some((t) => t.id === p.task_id))
  )
    throw new AppError(
      400,
      "EVALUATION_TASK_MISMATCH",
      "每个固定保留题必须恰好一对输出，不允许新增或遗漏",
    );
  await assertUntrained(
    tx,
    run.project_id,
    holdouts.map((t) => t.prompt),
  );
  const build = requireValue(
      await tx.query.skillBuilds.findFirst({
        where: eq(skillBuilds.id, run.build_id),
      }),
    ),
    rules = build.rules_snapshot.map((r) => ({
      id: String(r.id),
      config: ruleConfig.parse(r.config),
    }));
  const details = modelDetails(output.model_details, proof);
  for (const pair of output.pairs) {
    const leftSource = randomInt(2) === 0 ? "baseline" : "personalized",
      context = detectionContext.parse({
        domain: run.domain,
        project_id: run.project_id,
      }),
      baseline = detectPatterns(pair.baseline, rules, context),
      personalized = detectPatterns(pair.personalized, rules, context);
    await tx.insert(evaluationItems).values({
      owner_id: OWNER_ID,
      run_id: run.id,
      task_id: pair.task_id,
      left_source: leftSource,
      left_text: leftSource === "baseline" ? pair.baseline : pair.personalized,
      right_text: leftSource === "baseline" ? pair.personalized : pair.baseline,
      model_details_json: details,
      analysis_json: {
        baseline_pattern_hits: baseline.filter((f) => f.status === "review")
          .length,
        personalized_pattern_hits: personalized.filter(
          (f) => f.status === "review",
        ).length,
        semantic_warnings: semanticWarnings(pair.baseline, pair.personalized),
        simulated_rules: build.rules_snapshot.some(
          (r) =>
            (r.model_details as Record<string, unknown> | null)?.simulated ===
            true,
        ),
      },
    });
  }
  return finishModelJob(tx, id, {
    run_id: run.id,
    pair_count: output.pairs.length,
    notice: "随机映射已在服务端保存；投票完成前不返回来源或分析",
  });
}
export async function ownedEvaluation(id: string, tx: Tx | typeof db = db) {
  return requireValue(
    await tx.query.evaluationRuns.findFirst({
      where: and(
        eq(evaluationRuns.id, id),
        eq(evaluationRuns.owner_id, OWNER_ID),
      ),
    }),
  );
}
export async function listEvaluations() {
  const runs = await db
    .select()
    .from(evaluationRuns)
    .where(eq(evaluationRuns.owner_id, OWNER_ID))
    .orderBy(desc(evaluationRuns.created_at));
  return Promise.all(
    runs.map(async (run) => {
      const job = requireValue(
          await db.query.jobs.findFirst({ where: eq(jobs.id, run.job_id) }),
        ),
        votes = await db
          .select({ id: evaluationVotes.id })
          .from(evaluationVotes)
          .where(eq(evaluationVotes.run_id, run.id)),
        holdouts = await db
          .select({ id: evaluationTasks.id })
          .from(evaluationTasks)
          .where(eq(evaluationTasks.run_id, run.id));
      return {
        ...run,
        job_status: job.status,
        task_count: holdouts.length,
        voted_count: votes.length,
      };
    }),
  );
}
export async function getEvaluation(id: string) {
  const run = await ownedEvaluation(id),
    build = requireValue(
      await db.query.skillBuilds.findFirst({
        where: eq(skillBuilds.id, run.build_id),
      }),
    ),
    job = requireValue(
      await db.query.jobs.findFirst({ where: eq(jobs.id, run.job_id) }),
    ),
    holdouts = await db
      .select()
      .from(evaluationTasks)
      .where(eq(evaluationTasks.run_id, id))
      .orderBy(evaluationTasks.position),
    items = await db
      .select()
      .from(evaluationItems)
      .where(eq(evaluationItems.run_id, id)),
    votes = await db
      .select()
      .from(evaluationVotes)
      .where(eq(evaluationVotes.run_id, id));
  return {
    run,
    build: {
      id: build.id,
      type: build.skill_type,
      version: build.semantic_version,
      hash: build.content_hash,
    },
    job: { id: job.id, status: job.status, error_code: job.error_code },
    simulated: items.some(
      (i) =>
        i.model_details_json.simulated === true ||
        i.analysis_json.simulated_rules === true,
    ),
    task_count: holdouts.length,
    voted_count: votes.length,
    items: holdouts.map((t) => {
      const item = items.find((i) => i.task_id === t.id),
        vote = item && votes.find((v) => v.item_id === item.id);
      return {
        task_id: t.id,
        title: t.title,
        prompt: t.prompt,
        constraints: t.constraints_json,
        item_id: item?.id ?? null,
        left: item?.left_text ?? null,
        right: item?.right_text ?? null,
        vote: vote
          ? {
              choice: vote.vote,
              origin: vote.origin,
              comment: vote.comment,
              semantic_review: vote.semantic_review,
            }
          : null,
      };
    }),
  };
}
export const evaluationVoteInput = z
  .object({
    item_id: z.uuid(),
    vote: z.enum(["left", "right", "tie", "both_bad"]),
    origin: z.enum(["human", "test"]),
    comment: z.string().max(3000).default(""),
    semantic_review: z
      .enum(["pass", "risk", "not_reviewed"])
      .default("not_reviewed"),
  })
  .strict();
export async function saveEvaluationVote(
  tx: Tx,
  runId: string,
  input: z.infer<typeof evaluationVoteInput>,
) {
  const run = await ownedEvaluation(runId, tx);
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${OWNER_ID + run.id + ":vote"}))`,
  );
  const item = requireValue(
    await tx.query.evaluationItems.findFirst({
      where: and(
        eq(evaluationItems.id, input.item_id),
        eq(evaluationItems.run_id, runId),
        eq(evaluationItems.owner_id, OWNER_ID),
      ),
    }),
  );
  const exists = await tx.query.evaluationVotes.findFirst({
    where: and(
      eq(evaluationVotes.item_id, item.id),
      eq(evaluationVotes.owner_id, OWNER_ID),
    ),
  });
  if (exists)
    throw new AppError(
      409,
      "VOTE_ALREADY_SAVED",
      "这道题已投票；原票不可被覆盖",
    );
  const [vote] = await tx
    .insert(evaluationVotes)
    .values({
      owner_id: OWNER_ID,
      actor_id: OWNER_ID,
      run_id: runId,
      item_id: item.id,
      vote: input.vote,
      origin:
        run.test_run || new URL(env.DATABASE_URL).pathname.endsWith("_test")
          ? "test"
          : input.origin,
      comment: input.comment,
      semantic_review: input.semantic_review,
    })
    .returning();
  return {
    vote_id: vote.id,
    item_id: item.id,
    origin: vote.origin,
    notice: "投票已保存；全部题完成后才揭示来源",
  };
}
export function preferenceMetrics(
  rows: { vote: string; left_source: string; semantic_review?: string }[],
) {
  let personalized_wins = 0,
    baseline_wins = 0,
    ties = 0,
    both_bad = 0;
  for (const row of rows) {
    if (row.vote === "tie") ties++;
    else if (row.vote === "both_bad") both_bad++;
    else if (
      (row.vote === "left"
        ? row.left_source
        : row.left_source === "baseline"
          ? "personalized"
          : "baseline") === "personalized"
    )
      personalized_wins++;
    else baseline_wins++;
  }
  const decisive = personalized_wins + baseline_wins,
    reviewed = rows.filter(
      (r) => r.semantic_review === "pass" || r.semantic_review === "risk",
    );
  return {
    sample_count: rows.length,
    personalized_wins,
    baseline_wins,
    ties,
    both_bad,
    decisive_count: decisive,
    preference_win_rate: decisive ? personalized_wins / decisive : null,
    semantic_review_count: reviewed.length,
    semantic_pass_rate: reviewed.length
      ? reviewed.filter((r) => r.semantic_review === "pass").length /
        reviewed.length
      : null,
    win_rate_definition:
      "personalized_wins / (personalized_wins + baseline_wins)，平局与双拒单列",
  };
}
export async function evaluationResults(id: string) {
  const view = await getEvaluation(id);
  if (view.job.status !== "succeeded" || view.voted_count !== view.task_count)
    return {
      status: "awaiting_votes",
      remaining: view.task_count - view.voted_count,
      human_sample_count: view.items.filter(
        (i) => i.vote?.origin === "human" && !view.simulated,
      ).length,
      metrics: null,
      mapping: null,
      notice: "待评测：投票未完成，不展示胜率、身份或模型自评",
    };
  const items = await db
      .select()
      .from(evaluationItems)
      .where(eq(evaluationItems.run_id, id)),
    votes = await db
      .select()
      .from(evaluationVotes)
      .where(eq(evaluationVotes.run_id, id));
  const joined = votes.map((v) => ({
      ...v,
      ...{
        left_source: requireValue(items.find((i) => i.id === v.item_id))
          .left_source,
      },
    })),
    human = joined.filter((v) => v.origin === "human" && !view.simulated),
    test = joined.filter((v) => v.origin === "test"),
    simulatedHuman = joined.filter(
      (v) => v.origin === "human" && view.simulated,
    );
  const reviews = await db
      .select()
      .from(patternReviews)
      .where(
        and(
          eq(patternReviews.owner_id, OWNER_ID),
          eq(patternReviews.project_id, view.run.project_id),
        ),
      ),
    falsePositives = reviews.filter(
      (r) => r.event_type === "pattern_false_positive",
    ).length,
    confirmedReviews = reviews.filter(
      (r) => r.event_type === "pattern_confirmed",
    ).length,
    revisionRows = await db
      .select()
      .from(revisions)
      .where(
        and(
          eq(revisions.owner_id, OWNER_ID),
          sql`${revisions.session_id} IN (SELECT id FROM sessions WHERE owner_id=${OWNER_ID} AND project_id=${view.run.project_id})`,
        ),
      ),
    accepted = revisionRows.filter((r) => r.status === "accepted").length,
    rejected = revisionRows.filter((r) => r.status === "rejected").length;
  const diagnostics = {
    baseline_pattern_hits: items.reduce(
      (n, i) => n + Number(i.analysis_json.baseline_pattern_hits ?? 0),
      0,
    ),
    personalized_pattern_hits: items.reduce(
      (n, i) => n + Number(i.analysis_json.personalized_pattern_hits ?? 0),
      0,
    ),
    pattern_review_count: reviews.length,
    false_positives: falsePositives,
    confirmed_pattern_reviews: confirmedReviews,
    false_positive_rate:
      falsePositives + confirmedReviews
        ? falsePositives / (falsePositives + confirmedReviews)
        : null,
    exception_reviews: reviews.filter(
      (r) => r.event_type === "pattern_exception",
    ).length,
    revision_accepted: accepted,
    revision_rejected: rejected,
    revision_acceptance_rate:
      accepted + rejected ? accepted / (accepted + rejected) : null,
    notice:
      "确定性命中与本项目复核/建议处理的操作记录，不是模型质量或真人改善证明；误报率分母仅含误报与确认命中，例外单列",
  };
  return {
    status: human.length ? "human_votes_recorded" : "awaiting_human_evidence",
    diagnostics,
    remaining: 0,
    human_sample_count: human.length,
    human_votes_total: joined.filter((v) => v.origin === "human").length,
    test_sample_count: test.length,
    simulated_human_sample_count: simulatedHuman.length,
    metrics: human.length ? preferenceMetrics(human) : null,
    test_metrics: test.length ? preferenceMetrics(test) : null,
    mapping: items.map((item) => ({
      item_id: item.id,
      task_id: item.task_id,
      left_source: item.left_source,
      right_source:
        item.left_source === "baseline" ? "personalized" : "baseline",
      model_details: item.model_details_json,
      analysis: item.analysis_json,
    })),
    build: view.build,
    holdout_source: view.run.holdout_source,
    notice: human.length
      ? "投票由本地用户提交，非供应商核验；样本量有限，不能据此保证普遍改善。模型配置与静态命中仅供复核。"
      : "待评测：没有可用于真实偏好结论的真人票。测试票和模拟输出不代表改善。",
  };
}
