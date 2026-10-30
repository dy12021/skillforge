import { randomUUID, randomInt } from "node:crypto";
import { z } from "zod";
import { and, eq, desc, inArray, isNull } from "drizzle-orm";
import { db, OWNER_ID, type Tx } from "./db";
import {
  sessions,
  tasks,
  jobs,
  candidateSets,
  candidates,
  documentVersions,
  feedbackEvents,
  annotations,
  revisions,
  generatedTopics,
  corpusAssets,
  corpusSegments,
} from "./schema";
import { getProject } from "./projects";
import { AppError, requireValue } from "./errors";
import { topicSchema } from "./models";
export const generationInput = z
  .object({
    source: z.enum(["auto", "manual", "corpus-derived"]).default("auto"),
    prompt: z.string().trim().max(12000).default(""),
    corpus_asset_id: z.uuid().optional(),
    corpus_segment_id: z.uuid().optional(),
    data_transfer_confirmed: z.boolean().optional(),
    granularity: z
      .enum([
        "phrase",
        "sentence",
        "paragraph",
        "article",
        "single-turn",
        "multi-turn",
      ])
      .default("paragraph"),
    target_dimension: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .default("具体、自然，保持事实"),
    candidate_count: z.number().int().min(2).max(8).default(3),
    generation_source: z.enum(["agent", "provider"]).default("agent"),
    strategy: z.enum(["diverse", "focused", "challenger"]).default("diverse"),
    topic_id: z.uuid().optional(),
    champion_candidate_id: z.uuid().optional(),
  })
  .strict()
  .refine((v) => v.source === "auto" || v.prompt.length > 0, {
    message: "手动或语料衍生任务必须提供 prompt",
    path: ["prompt"],
  })
  .refine(
    (v) =>
      v.source !== "corpus-derived" ||
      (!!v.corpus_asset_id &&
        !!v.corpus_segment_id &&
        v.data_transfer_confirmed === true),
    {
      message:
        "语料衍生任务须选择来源片段并明确允许将自行编写的题目交给所选模型",
      path: ["data_transfer_confirmed"],
    },
  );
export const sessionInput = generationInput.safeExtend({
  project_id: z.uuid(),
  mode: z.enum(["writing", "dialogue"]),
});
export type GenerationInput = z.infer<typeof generationInput>;
export const generatedOutput = z
  .object({
    topic: topicSchema,
    candidates: z.array(z.string().trim().min(1).max(20000)).min(2).max(8),
    model_details: z
      .object({
        agent_name: z.string().min(1).max(100),
        model: z.string().max(200).nullable().default(null),
        prompt_version: z.string().max(100).default("agent-training-v1"),
        latency_ms: z.number().nonnegative().nullable().default(null),
        token_usage: z.number().nonnegative().nullable().default(null),
        seed: z.number().nullable().default(null),
        decoding: z.record(z.string(), z.unknown()).default({}),
      })
      .strict(),
  })
  .strict();
export type GeneratedOutput = z.infer<typeof generatedOutput>;
export function shuffled<T>(items: T[]): T[] {
  const output = [...items];
  for (let i = output.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [output[i], output[j]] = [output[j], output[i]];
  }
  return output;
}
export function textDocument(text: string) {
  return {
    type: "doc",
    content: text.split("\n").map((line) => ({
      type: "paragraph",
      ...(line ? { content: [{ type: "text", text: line }] } : {}),
    })),
  };
}
export async function ownedSession(id: string, tx: Tx | typeof db = db) {
  return requireValue(
    await tx.query.sessions.findFirst({
      where: and(eq(sessions.id, id), eq(sessions.owner_id, OWNER_ID)),
    }),
  );
}
export async function createSession(
  tx: Tx,
  input: z.infer<typeof sessionInput>,
) {
  const project = await getProject(input.project_id, tx);
  if (project.domain !== input.mode)
    throw new AppError(400, "DOMAIN_MISMATCH", "会话模式必须与项目用途一致");
  const [session] = await tx
    .insert(sessions)
    .values({ project_id: project.id, owner_id: OWNER_ID, mode: input.mode })
    .returning();
  const job = await queueGeneration(
    tx,
    session.id,
    input,
    input.mode,
    project.id,
  );
  return {
    session,
    job_id: job.id,
    job,
    generation_request: job.payload,
    url: `/sessions/${session.id}/compare`,
  };
}
async function queueGeneration(
  tx: Tx,
  session_id: string,
  input: GenerationInput,
  mode: string,
  projectId: string,
) {
  if (input.source !== "auto") {
    const { assertTrainingPrompt } = await import("./holdout-boundary");
    await assertTrainingPrompt(tx, projectId, input.prompt);
  }
  if (input.source === "corpus-derived") {
    const [asset] = await tx
      .select({ id: corpusAssets.id })
      .from(corpusAssets)
      .where(
        and(
          eq(corpusAssets.id, input.corpus_asset_id!),
          eq(corpusAssets.owner_id, OWNER_ID),
          eq(corpusAssets.project_id, projectId),
          isNull(corpusAssets.deleted_at),
        ),
      )
      .for("update");
    requireValue(asset, "所选语料不存在、已删除或不属于本项目");
    const [segment] = await tx
      .select({ id: corpusSegments.id })
      .from(corpusSegments)
      .where(
        and(
          eq(corpusSegments.id, input.corpus_segment_id!),
          eq(corpusSegments.asset_id, asset.id),
          eq(corpusSegments.owner_id, OWNER_ID),
        ),
      );
    requireValue(segment, "所选片段不存在或不属于该语料");
  }
  const { effectiveRules } = await import("./preferences");
  const { detectionContext } = await import("./rule-types");
  const project = await getProject(projectId, tx);
  const rules = await effectiveRules(
    detectionContext.parse({
      domain: mode,
      project_id: projectId,
      genre: project.genre,
    }),
    tx,
  );
  let topic = null,
    champion = null;
  if (input.topic_id) {
    const saved = requireValue(
      await tx.query.generatedTopics.findFirst({
        where: and(
          eq(generatedTopics.id, input.topic_id),
          eq(generatedTopics.project_id, projectId),
          eq(generatedTopics.owner_id, OWNER_ID),
        ),
      }),
    );
    topic = topicSchema.parse(saved.topic_json);
  }
  if (input.strategy === "challenger") {
    const events = await tx
      .select()
      .from(feedbackEvents)
      .where(eq(feedbackEvents.session_id, session_id))
      .orderBy(desc(feedbackEvents.created_at));
    const undone = new Set(
      events
        .filter((e) => e.event_type === "feedback_undone")
        .map((e) => e.payload_json.event_id),
    );
    const winner = events.find(
      (e) => e.event_type === "candidate_selected" && !undone.has(e.id),
    );
    const winnerId =
      input.champion_candidate_id ??
      (winner?.payload_json.approved_ids as string[] | undefined)?.[0];
    if (!winnerId)
      throw new AppError(
        409,
        "CHAMPION_REQUIRED",
        "请先选一个最佳候选，或明确指定挑战对象",
      );
    const candidate = requireValue(
      await tx.query.candidates.findFirst({
        where: eq(candidates.id, winnerId),
      }),
    );
    const set = requireValue(
      await tx.query.candidateSets.findFirst({
        where: eq(candidateSets.id, candidate.set_id),
      }),
    );
    const task = requireValue(
      await tx.query.tasks.findFirst({
        where: and(eq(tasks.id, set.task_id), eq(tasks.session_id, session_id)),
      }),
    );
    topic = {
      title: task.title,
      prompt: task.prompt,
      genre: task.genre,
      target_dimension: task.target_dimension,
      difficulty: task.difficulty,
      constraints: task.constraints_json,
      generation_id: task.generation_id ?? task.id,
    };
    champion = { candidate_id: candidate.id, text: candidate.text };
  }
  const prior = await tx
    .select({ prompt: tasks.prompt })
    .from(tasks)
    .innerJoin(sessions, eq(tasks.session_id, sessions.id))
    .where(eq(sessions.project_id, projectId))
    .limit(40);
  const events = await tx
    .select()
    .from(feedbackEvents)
    .where(
      and(
        eq(feedbackEvents.session_id, session_id),
        eq(feedbackEvents.owner_id, OWNER_ID),
      ),
    )
    .orderBy(desc(feedbackEvents.created_at));
  const undone = new Set(
    events
      .filter((event) => event.event_type === "feedback_undone")
      .map((event) => String(event.payload_json.event_id)),
  );
  const active = events.filter(
    (event) => event.event_type !== "feedback_undone" && !undone.has(event.id),
  );
  const selected = active.slice(0, 20);
  const taskIds = [
    ...new Set(
      selected.map((event) => event.task_id).filter((id): id is string => !!id),
    ),
  ];
  const relatedCandidates = taskIds.length
    ? await tx
        .select({ id: candidates.id, task_id: tasks.id, text: candidates.text })
        .from(candidates)
        .innerJoin(candidateSets, eq(candidates.set_id, candidateSets.id))
        .innerJoin(tasks, eq(candidateSets.task_id, tasks.id))
        .where(
          and(eq(tasks.session_id, session_id), inArray(tasks.id, taskIds)),
        )
    : [];
  const feedbackContext = {
    total_active: active.length,
    event_limit: 20,
    events: selected.map((event) => ({
      id: event.id,
      task_id: event.task_id,
      event_type: event.event_type,
      payload: event.payload_json,
    })),
    candidates: relatedCandidates.map((candidate) => ({
      id: candidate.id,
      task_id: candidate.task_id,
      text_excerpt: Array.from(candidate.text).slice(0, 1200).join(""),
      truncated: Array.from(candidate.text).length > 1200,
    })),
    notice:
      "按原始事件语义参考，不推断认可候选之间的排序；候选上下文最多1200字符。已撤销事件不包含在创建时快照中。",
  };
  return (
    await tx
      .insert(jobs)
      .values({
        session_id,
        project_id: projectId,
        owner_id: OWNER_ID,
        status:
          input.generation_source === "agent" ? "awaiting_agent" : "queued",
        payload: {
          ...input,
          mode,
          topic,
          champion,
          feedback_context: feedbackContext,
          confirmed_rules: rules.map((r) => ({
            id: r.id,
            version: r.version,
            config: r.config,
          })),
          previous_topics: prior.map((t) => t.prompt),
          prompt_version: "training-v1",
        },
      })
      .returning()
  )[0];
}
export async function nextRound(
  tx: Tx,
  id: string,
  input: GenerationInput & { expected_version: number },
) {
  const [session] = await tx
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, id), eq(sessions.owner_id, OWNER_ID)))
    .for("update");
  requireValue(session);
  if (
    session.version !== input.expected_version ||
    session.state === "awaiting_generation" ||
    session.state === "completed"
  )
    throw new AppError(
      409,
      "SESSION_CONFLICT",
      "会话版本已变化或当前不能继续生成，请刷新",
    );
  await getProject(session.project_id, tx);
  await tx
    .update(sessions)
    .set({ state: "awaiting_generation", version: session.version + 1 })
    .where(eq(sessions.id, id));
  const job = await queueGeneration(
    tx,
    id,
    input,
    session.mode,
    session.project_id,
  );
  return { job_id: job.id, job, generation_request: job.payload };
}
export async function completeGeneration(
  tx: Tx,
  id: string,
  output: GeneratedOutput,
  provider?: {
    name: string;
    lease_token: string;
    metadata: Record<string, unknown>;
  },
) {
  const [job] = await tx
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, id), eq(jobs.owner_id, OWNER_ID)))
    .for("update");
  requireValue(job);
  if (
    provider
      ? job.status !== "running" || job.lease_token !== provider.lease_token
      : job.status !== "awaiting_agent"
  )
    throw new AppError(
      409,
      "JOB_CONFLICT",
      "任务已处理、已取消或不允许由当前来源提交",
    );
  const config = generationInput.strip().parse(job.payload);
  const [lockedSession] = await tx
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.id, requireValue(job.session_id)),
        eq(sessions.owner_id, OWNER_ID),
      ),
    )
    .for("update");
  const session = requireValue(lockedSession);
  const { assertTrainingPrompt } = await import("./holdout-boundary");
  await assertTrainingPrompt(tx, session.project_id, output.topic.prompt);
  const fixedTopic = job.payload.topic as { prompt: string } | null,
    champion = job.payload.champion as { text: string } | null;
  if (fixedTopic && fixedTopic.prompt !== output.topic.prompt)
    throw new AppError(
      400,
      "PROMPT_CHANGED",
      "不得修改指定或挑战任务的 prompt",
    );
  if (champion && output.candidates[0] !== champion.text)
    throw new AppError(
      400,
      "CHAMPION_CHANGED",
      "挑战模式首个候选必须逐字保留当前最佳",
    );
  if (
    config.source === "auto" &&
    config.strategy !== "challenger" &&
    !fixedTopic
  ) {
    const prior = await tx
      .select({ prompt: tasks.prompt })
      .from(tasks)
      .innerJoin(sessions, eq(tasks.session_id, sessions.id))
      .where(eq(sessions.project_id, session.project_id));
    const normalized = (s: string) =>
      s.normalize("NFC").replace(/\s+/gu, " ").trim();
    if (
      prior.some(
        (t) => normalized(t.prompt) === normalized(output.topic.prompt),
      )
    )
      throw new AppError(
        409,
        "DUPLICATE_TOPIC",
        "此项目已有相同题目，请生成新题或使用挑战模式",
      );
  }
  if (output.candidates.length !== config.candidate_count)
    throw new AppError(400, "CANDIDATE_COUNT", "候选数量与任务要求不一致");
  if (new Set(output.candidates).size !== output.candidates.length)
    throw new AppError(400, "DUPLICATE_CANDIDATES", "候选不能完全重复");
  if (config.source !== "auto" && output.topic.prompt !== config.prompt)
    throw new AppError(400, "PROMPT_CHANGED", "不得修改用户指定的任务");
  const [task] = await tx
    .insert(tasks)
    .values({
      session_id: session.id,
      source: config.source,
      title: output.topic.title,
      prompt: output.topic.prompt,
      genre: output.topic.genre,
      granularity: config.granularity,
      target_dimension: config.target_dimension,
      difficulty: output.topic.difficulty,
      constraints_json: output.topic.constraints,
      generation_id: output.topic.generation_id,
      prompt_version: output.model_details.prompt_version,
    })
    .returning();
  const candidateIds = output.candidates.map(() => randomUUID()),
    setId = randomUUID();
  const details = provider
    ? { ...provider.metadata, provenance: "provider-response" }
    : {
        ...output.model_details,
        provider: "agent",
        provenance: "agent-self-reported",
        simulated: false,
        verified_by_provider: false,
      };
  await tx.insert(candidateSets).values({
    id: setId,
    task_id: task.id,
    job_id: job.id,
    model_provider: provider?.name ?? "agent",
    generation_strategy: config.strategy,
    prompt_version: output.model_details.prompt_version,
    shuffled_order_json: shuffled(candidateIds),
  });
  for (const [i, text] of output.candidates.entries()) {
    const [version] = await tx
      .insert(documentVersions)
      .values({
        session_id: session.id,
        content_text: text,
        content_json: textDocument(text),
        revision_source: provider?.name ?? "agent",
      })
      .returning();
    await tx.insert(candidates).values({
      id: candidateIds[i],
      set_id: setId,
      document_version_id: version.id,
      text,
      position: i,
      model_details_json: details,
    });
  }
  const result = {
    task_id: task.id,
    set_id: setId,
    candidate_count: output.candidates.length,
    provider: provider?.name ?? "agent",
  };
  await tx
    .update(jobs)
    .set({
      status: "succeeded",
      result,
      lease_token: null,
      lease_until: null,
      updated_at: new Date(),
    })
    .where(eq(jobs.id, id));
  await tx
    .update(sessions)
    .set({ state: "comparing", version: session.version + 1 })
    .where(eq(sessions.id, session.id));
  return result;
}
export async function getJob(id: string) {
  return requireValue(
    await db.query.jobs.findFirst({
      where: and(eq(jobs.id, id), eq(jobs.owner_id, OWNER_ID)),
    }),
  );
}
export async function pendingAgentJobs() {
  return db
    .select()
    .from(jobs)
    .where(and(eq(jobs.owner_id, OWNER_ID), eq(jobs.status, "awaiting_agent")))
    .orderBy(jobs.created_at)
    .limit(50);
}
export async function sessionSnapshot(id: string) {
  const session = await ownedSession(id);
  const taskRows = await db
    .select()
    .from(tasks)
    .where(eq(tasks.session_id, id))
    .orderBy(tasks.created_at);
  const sets = taskRows.length
    ? await db
        .select()
        .from(candidateSets)
        .where(
          inArray(
            candidateSets.task_id,
            taskRows.map((t) => t.id),
          ),
        )
        .orderBy(candidateSets.created_at)
    : [];
  const candidateRows = sets.length
    ? await db
        .select()
        .from(candidates)
        .where(
          inArray(
            candidates.set_id,
            sets.map((s) => s.id),
          ),
        )
        .orderBy(candidates.position)
    : [];
  const versions = await db
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.session_id, id))
    .orderBy(documentVersions.created_at);
  const events = await db
    .select()
    .from(feedbackEvents)
    .where(eq(feedbackEvents.session_id, id))
    .orderBy(feedbackEvents.created_at);
  const annotationRows = versions.length
    ? await db
        .select()
        .from(annotations)
        .where(
          inArray(
            annotations.document_version_id,
            versions.map((v) => v.id),
          ),
        )
    : [];
  const jobRows = await db
    .select()
    .from(jobs)
    .where(eq(jobs.session_id, id))
    .orderBy(jobs.created_at);
  const revisionRows = await db
    .select()
    .from(revisions)
    .where(eq(revisions.session_id, id))
    .orderBy(revisions.created_at);
  return {
    session,
    tasks: taskRows,
    candidate_sets: sets,
    candidates: candidateRows,
    document_versions: versions,
    feedback_events: events,
    annotations: annotationRows,
    jobs: jobRows,
    revisions: revisionRows,
  };
}
export async function listSessions(projectId: string) {
  await getProject(projectId);
  return db
    .select()
    .from(sessions)
    .where(
      and(eq(sessions.project_id, projectId), eq(sessions.owner_id, OWNER_ID)),
    )
    .orderBy(desc(sessions.created_at));
}
export async function finishSession(
  tx: Tx,
  id: string,
  expected_version: number,
) {
  const session = await ownedSession(id, tx);
  if (
    session.version !== expected_version ||
    !["comparing", "feedback_saved"].includes(session.state)
  )
    throw new AppError(409, "SESSION_CONFLICT", "当前状态或版本不能完成会话");
  const [row] = await tx
    .update(sessions)
    .set({ state: "completed", version: expected_version + 1 })
    .where(and(eq(sessions.id, id), eq(sessions.version, expected_version)))
    .returning();
  if (!row) throw new AppError(409, "SESSION_CONFLICT", "会话已更新");
  return row;
}
