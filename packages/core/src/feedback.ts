import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { type Tx, OWNER_ID } from "./db";
import {
  feedbackEvents,
  sessions,
  tasks,
  candidateSets,
  candidates,
  documentVersions,
  jobs,
} from "./schema";
import { AppError, requireValue } from "./errors";
import { textDocument } from "./training";
export const feedbackInput = z
  .object({
    session_id: z.uuid(),
    task_id: z.uuid(),
    candidate_ids: z.array(z.uuid()).min(2).max(8),
    displayed_order: z.array(z.uuid()).min(2).max(8),
    feedback_mode: z
      .enum(["best_one", "approve_many", "full_ranking", "tie", "reject_all"])
      .nullable()
      .default(null),
    approved_ids: z.array(z.uuid()).max(8).default([]),
    ranking_groups: z
      .array(z.array(z.uuid()).min(1))
      .max(8)
      .nullable()
      .default(null),
    comments: z
      .array(
        z
          .object({
            candidate_id: z.uuid(),
            text: z.string().trim().min(1).max(4000),
          })
          .strict(),
      )
      .max(8)
      .default([]),
    human_edits: z
      .array(
        z
          .object({
            candidate_id: z.uuid(),
            original: z.string(),
            replacement: z.string().trim().min(1).max(20000),
          })
          .strict(),
      )
      .max(8)
      .default([]),
  })
  .strict();
export type FeedbackInput = z.infer<typeof feedbackInput>;
export function sameMembers(a: string[], b: string[]) {
  return (
    a.length === b.length &&
    new Set(a).size === a.length &&
    a.every((id) => b.includes(id))
  );
}
export function validateComparison(input: FeedbackInput) {
  const ids = input.candidate_ids,
    approved = input.approved_ids;
  if (
    new Set(approved).size !== approved.length ||
    !approved.every((id) => ids.includes(id))
  )
    throw new AppError(400, "INVALID_SELECTION", "选择中包含重复或未知候选");
  if (input.feedback_mode === "best_one" && approved.length !== 1)
    throw new AppError(400, "INVALID_SELECTION", "选一必须恰好一个候选");
  if (input.feedback_mode === "approve_many" && approved.length < 1)
    throw new AppError(400, "INVALID_SELECTION", "请至少认可一个候选");
  if (
    !["best_one", "approve_many"].includes(input.feedback_mode ?? "") &&
    approved.length
  )
    throw new AppError(400, "INVALID_SELECTION", "当前反馈类型不应包含获选者");
  if (input.feedback_mode === "full_ranking") {
    if (!input.ranking_groups || !sameMembers(input.ranking_groups.flat(), ids))
      throw new AppError(
        400,
        "INVALID_RANKING",
        "排序必须覆盖每个候选且不重复；允许并列组",
      );
  } else if (input.ranking_groups !== null)
    throw new AppError(
      400,
      "INVALID_RANKING",
      "只有完整排序接受 ranking_groups",
    );
  if (
    input.feedback_mode === null &&
    input.comments.length === 0 &&
    input.human_edits.length === 0
  )
    throw new AppError(400, "EMPTY_FEEDBACK", "请比较候选、添加评语或改写");
  for (const item of [...input.comments, ...input.human_edits])
    if (!ids.includes(item.candidate_id))
      throw new AppError(400, "UNKNOWN_CANDIDATE", "评语或改写指向未知候选");
}
const types = {
  best_one: "candidate_selected",
  approve_many: "candidates_approved",
  full_ranking: "candidates_ranked",
  tie: "candidates_tied",
  reject_all: "all_rejected",
};
export async function saveFeedback(tx: Tx, input: FeedbackInput, key: string) {
  validateComparison(input);
  const [session] = await tx
    .select()
    .from(sessions)
    .where(
      and(eq(sessions.id, input.session_id), eq(sessions.owner_id, OWNER_ID)),
    )
    .for("update");
  requireValue(session);
  if (session.state === "completed")
    throw new AppError(
      409,
      "SESSION_COMPLETED",
      "会话已结束，不能继续添加反馈",
    );
  const task = requireValue(
    await tx.query.tasks.findFirst({
      where: and(eq(tasks.id, input.task_id), eq(tasks.session_id, session.id)),
    }),
  );
  const set = requireValue(
    await tx.query.candidateSets.findFirst({
      where: eq(candidateSets.task_id, task.id),
    }),
  );
  const rows = await tx
    .select()
    .from(candidates)
    .where(eq(candidates.set_id, set.id))
    .orderBy(candidates.position);
  if (
    !sameMembers(
      input.candidate_ids,
      rows.map((c) => c.id),
    ) ||
    !sameMembers(input.displayed_order, set.shuffled_order_json) ||
    input.displayed_order.some((id, i) => id !== set.shuffled_order_json[i])
  )
    throw new AppError(
      400,
      "CANDIDATE_SET_MISMATCH",
      "候选集合或显示序列不匹配",
    );
  const base = { owner_id: OWNER_ID, session_id: session.id, task_id: task.id };
  const saved = [];
  const common = {
    set_id: set.id,
    candidate_ids: input.candidate_ids,
    original_order: rows.map((c) => c.id),
    displayed_order: input.displayed_order,
  };
  if (input.feedback_mode) {
    const [event] = await tx
      .insert(feedbackEvents)
      .values({
        ...base,
        event_type: types[input.feedback_mode],
        payload_json: {
          ...common,
          feedback_mode: input.feedback_mode,
          approved_ids: input.approved_ids,
          ranking_groups: input.ranking_groups,
        },
        idempotency_key: `${key}:comparison`,
      })
      .returning();
    saved.push(event);
  }
  for (const [i, item] of input.comments.entries()) {
    const [event] = await tx
      .insert(feedbackEvents)
      .values({
        ...base,
        event_type: "candidate_commented",
        payload_json: { ...common, ...item },
        idempotency_key: `${key}:comment:${i}`,
      })
      .returning();
    saved.push(event);
  }
  for (const [i, item] of input.human_edits.entries()) {
    const candidate = rows.find((c) => c.id === item.candidate_id)!;
    if (candidate.text !== item.original)
      throw new AppError(409, "ORIGINAL_MISMATCH", "人工改写的原文版本不匹配");
    const [version] = await tx
      .insert(documentVersions)
      .values({
        session_id: session.id,
        parent_version_id: candidate.document_version_id,
        content_text: item.replacement,
        content_json: textDocument(item.replacement),
        revision_source: "human",
      })
      .returning();
    const [event] = await tx
      .insert(feedbackEvents)
      .values({
        ...base,
        event_type: "human_rewrite",
        payload_json: {
          ...common,
          ...item,
          document_version_id: version.id,
          parent_version_id: candidate.document_version_id,
        },
        idempotency_key: `${key}:edit:${i}`,
      })
      .returning();
    saved.push(event);
  }
  await tx
    .update(sessions)
    .set({
      state:
        session.state === "awaiting_generation"
          ? "awaiting_generation"
          : "feedback_saved",
      version: session.version + 1,
    })
    .where(eq(sessions.id, session.id));
  return { events: saved };
}
export const undoInput = z
  .object({
    event_id: z.uuid(),
    reason: z.string().max(1000).default("用户撤销"),
  })
  .strict();
export async function undoFeedback(
  tx: Tx,
  input: z.infer<typeof undoInput>,
  key: string,
) {
  const original = requireValue(
    await tx.query.feedbackEvents.findFirst({
      where: and(
        eq(feedbackEvents.id, input.event_id),
        eq(feedbackEvents.owner_id, OWNER_ID),
      ),
    }),
  );
  if (original.event_type === "feedback_undone")
    throw new AppError(400, "INVALID_UNDO", "不能撤销补偿事件");
  const [session] = await tx
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.id, original.session_id),
        eq(sessions.owner_id, OWNER_ID),
      ),
    )
    .for("update");
  requireValue(session);
  const [event] = await tx
    .insert(feedbackEvents)
    .values({
      owner_id: OWNER_ID,
      session_id: original.session_id,
      task_id: original.task_id,
      event_type: "feedback_undone",
      payload_json: { event_id: original.id, reason: input.reason },
      idempotency_key: key,
    })
    .returning();
  const pending = await tx
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.owner_id, OWNER_ID),
        eq(jobs.session_id, session.id),
        eq(jobs.job_type, "training"),
      ),
    )
    .for("update");
  let cancelled = false;
  for (const job of pending) {
    const context = job.payload.feedback_context as
      { events?: { id: string }[] } | undefined;
    if (
      ["awaiting_agent", "queued", "running"].includes(job.status) &&
      context?.events?.some((item) => item.id === original.id)
    ) {
      await tx
        .update(jobs)
        .set({
          status: "cancelled",
          error_code: "FEEDBACK_CHANGED",
          payload: { ...job.payload, feedback_snapshot_invalidated: true },
          lease_token: null,
          lease_until: null,
          updated_at: new Date(),
        })
        .where(eq(jobs.id, job.id));
      cancelled = true;
    }
  }
  await tx
    .update(sessions)
    .set({
      version: session.version + 1,
      state:
        cancelled && session.state === "awaiting_generation"
          ? "feedback_saved"
          : session.state,
    })
    .where(eq(sessions.id, session.id));
  return { ...event, cancelled_generation: cancelled };
}
