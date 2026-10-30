import { createHash } from "node:crypto";
import { z } from "zod";
import { and, eq, desc } from "drizzle-orm";
import { db, OWNER_ID, type Tx } from "./db";
import { jobs, generatedTopics, tasks, sessions } from "./schema";
import { getProject } from "./projects";
import { topicSchema } from "./models";
import {
  agentDetails,
  lockModelJob,
  modelDetails,
  finishModelJob,
  type ProviderProof,
} from "./model-jobs";
import { AppError, requireValue } from "./errors";
export const topicRequest = z
  .object({
    project_id: z.uuid(),
    generation_source: z.enum(["agent", "provider"]).default("agent"),
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
    target_dimension: z.string().min(1).max(200).default("具体自然，保持事实"),
  })
  .strict();
export const topicOutput = z
  .object({ topic: topicSchema, model_details: agentDetails })
  .strict();
export async function requestTopic(
  tx: Tx,
  input: z.infer<typeof topicRequest>,
) {
  const project = await getProject(input.project_id, tx);
  const prior = await tx
    .select()
    .from(generatedTopics)
    .where(
      and(
        eq(generatedTopics.project_id, project.id),
        eq(generatedTopics.owner_id, OWNER_ID),
      ),
    )
    .orderBy(desc(generatedTopics.created_at))
    .limit(30);
  const [job] = await tx
    .insert(jobs)
    .values({
      owner_id: OWNER_ID,
      project_id: project.id,
      job_type: "topic",
      status: input.generation_source === "agent" ? "awaiting_agent" : "queued",
      payload: {
        ...input,
        mode: project.domain,
        previous_topics: [
          ...prior.map((t) => t.topic_json),
          ...(await tx
            .select({ prompt: tasks.prompt })
            .from(tasks)
            .innerJoin(sessions, eq(tasks.session_id, sessions.id))
            .where(
              and(
                eq(sessions.owner_id, OWNER_ID),
                eq(sessions.project_id, project.id),
              ),
            )),
        ],
        output_contract: "topic,model_details；避免重复已有 prompt",
      },
    })
    .returning();
  return { job, job_id: job.id };
}
export async function completeTopic(
  tx: Tx,
  id: string,
  raw: unknown,
  proof?: ProviderProof,
) {
  const output = topicOutput.parse(raw),
    job = await lockModelJob(tx, id, "topic", proof),
    projectId = requireValue(job.project_id);
  const { assertTrainingPrompt } = await import("./holdout-boundary");
  await assertTrainingPrompt(tx, projectId, output.topic.prompt);
  const hash = createHash("sha256")
    .update(output.topic.prompt.normalize("NFC").replace(/\s+/gu, " ").trim())
    .digest("hex");
  const trained = await tx
    .select({ prompt: tasks.prompt })
    .from(tasks)
    .innerJoin(sessions, eq(tasks.session_id, sessions.id))
    .where(
      and(eq(sessions.owner_id, OWNER_ID), eq(sessions.project_id, projectId)),
    );
  const norm = (s: string) => s.normalize("NFC").replace(/\s+/gu, " ").trim();
  if (trained.some((t) => norm(t.prompt) === norm(output.topic.prompt)))
    throw new AppError(
      409,
      "DUPLICATE_TOPIC",
      "此项目训练历史已有相同题目，请生成新题",
    );
  const duplicate = await tx.query.generatedTopics.findFirst({
    where: and(
      eq(generatedTopics.owner_id, OWNER_ID),
      eq(generatedTopics.project_id, projectId),
      eq(generatedTopics.content_hash, hash),
    ),
  });
  if (duplicate)
    throw new AppError(409, "DUPLICATE_TOPIC", "相同项目已有此题，请更换题目");
  const [topic] = await tx
    .insert(generatedTopics)
    .values({
      owner_id: OWNER_ID,
      project_id: projectId,
      job_id: id,
      topic_json: output.topic,
      content_hash: hash,
      model_details_json: modelDetails(output.model_details, proof),
    })
    .returning();
  return finishModelJob(tx, id, { topic_id: topic.id, topic: output.topic });
}
export async function listTopics(projectId: string) {
  await getProject(projectId);
  return db
    .select()
    .from(generatedTopics)
    .where(
      and(
        eq(generatedTopics.owner_id, OWNER_ID),
        eq(generatedTopics.project_id, projectId),
      ),
    )
    .orderBy(desc(generatedTopics.created_at));
}
