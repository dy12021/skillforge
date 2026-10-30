import { createHash } from "node:crypto";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { type Tx, OWNER_ID } from "./db";
import {
  annotations,
  documentVersions,
  candidates,
  candidateSets,
  tasks,
  feedbackEvents,
} from "./schema";
import { ownedSession, textDocument } from "./training";
import { AppError, requireValue } from "./errors";
export const annotationInput = z
  .object({
    document_version_id: z.uuid(),
    block_id: z.string().default("document"),
    start_utf16: z.number().int().nonnegative(),
    end_utf16: z.number().int().positive(),
    exact_quote: z.string().min(1),
    context_before: z.string().default(""),
    context_after: z.string().default(""),
    label: z.enum(["excellent", "ai_like", "unsatisfied", "other"]),
    comment: z.string().max(4000).default(""),
    human_rewrite: z.string().max(20000).nullable().default(null),
    reanchored_from_id: z.uuid().optional(),
  })
  .strict();
export function quoteHash(quote: string) {
  return createHash("sha256").update(quote).digest("hex");
}
export function validateAnchor(
  text: string,
  input: Pick<
    z.infer<typeof annotationInput>,
    "start_utf16" | "end_utf16" | "exact_quote"
  >,
) {
  const { start_utf16: start, end_utf16: end, exact_quote: quote } = input;
  if (start >= end || end > text.length || text.slice(start, end) !== quote)
    throw new AppError(
      409,
      "ANCHOR_MISMATCH",
      "选区与该不可变版本不匹配，需要重新定位",
    );
  // Forbid slicing either half of a UTF-16 surrogate pair.
  const splits = (offset: number) =>
    offset > 0 &&
    offset < text.length &&
    /[\uD800-\uDBFF]/.test(text[offset - 1]) &&
    /[\uDC00-\uDFFF]/.test(text[offset]);
  if (splits(start) || splits(end))
    throw new AppError(400, "INVALID_UTF16", "不能拆开 emoji 的 UTF-16 代理对");
  return quoteHash(quote);
}
export async function versionTask(tx: Tx, versionId: string) {
  let version = requireValue(
    await tx.query.documentVersions.findFirst({
      where: eq(documentVersions.id, versionId),
    }),
  );
  for (let i = 0; i < 200; i++) {
    const candidate = await tx.query.candidates.findFirst({
      where: eq(candidates.document_version_id, version.id),
    });
    if (candidate) {
      const set = requireValue(
        await tx.query.candidateSets.findFirst({
          where: eq(candidateSets.id, candidate.set_id),
        }),
      );
      return requireValue(
        await tx.query.tasks.findFirst({ where: eq(tasks.id, set.task_id) }),
      );
    }
    if (!version.parent_version_id) break;
    version = requireValue(
      await tx.query.documentVersions.findFirst({
        where: eq(documentVersions.id, version.parent_version_id),
      }),
    );
  }
  throw new AppError(404, "TASK_NOT_FOUND", "文档没有可关联的训练任务");
}
export async function addAnnotation(
  tx: Tx,
  input: z.infer<typeof annotationInput>,
  key: string,
) {
  const version = requireValue(
    await tx.query.documentVersions.findFirst({
      where: eq(documentVersions.id, input.document_version_id),
    }),
  );
  await ownedSession(version.session_id, tx);
  if (input.reanchored_from_id) {
    const prior = requireValue(
      await tx.query.annotations.findFirst({
        where: eq(annotations.id, input.reanchored_from_id),
      }),
    );
    const original = requireValue(
      await tx.query.documentVersions.findFirst({
        where: eq(documentVersions.id, prior.document_version_id),
      }),
    );
    if (
      original.session_id !== version.session_id ||
      original.id === version.id
    )
      throw new AppError(
        409,
        "REANCHOR_VERSION_MISMATCH",
        "只能把同一会话旧版本的批注显式重新定位到新版本",
      );
  }
  // One stable text block for the first slice. Offsets are UTF-16 in content_text.
  if (input.block_id !== "document")
    throw new AppError(
      400,
      "BLOCK_NOT_SUPPORTED",
      "当前圈选使用稳定 document 文本块",
    );
  const hash = validateAnchor(version.content_text, input),
    task = await versionTask(tx, version.id);
  const [annotation] = await tx
    .insert(annotations)
    .values({
      ...input,
      quote_hash: hash,
      context_before: version.content_text.slice(
        Math.max(0, input.start_utf16 - 30),
        input.start_utf16,
      ),
      context_after: version.content_text.slice(
        input.end_utf16,
        input.end_utf16 + 30,
      ),
    })
    .returning();
  const [event] = await tx
    .insert(feedbackEvents)
    .values({
      owner_id: OWNER_ID,
      session_id: version.session_id,
      task_id: task.id,
      event_type: "span_annotated",
      payload_json: {
        annotation_id: annotation.id,
        ...input,
        quote_hash: hash,
      },
      idempotency_key: key,
    })
    .returning();
  return { annotation, event };
}
export const manualRevisionInput = z
  .object({
    document_version_id: z.uuid(),
    content_text: z.string().min(1).max(20000),
    operation: z
      .enum(["manual_edit", "revise_selection"])
      .default("manual_edit"),
    start_utf16: z.number().int().nonnegative().optional(),
    end_utf16: z.number().int().positive().optional(),
    exact_quote: z.string().optional(),
  })
  .strict();
export async function manualRevision(
  tx: Tx,
  input: z.infer<typeof manualRevisionInput>,
  key: string,
) {
  const parent = requireValue(
    await tx.query.documentVersions.findFirst({
      where: eq(documentVersions.id, input.document_version_id),
    }),
  );
  await ownedSession(parent.session_id, tx);
  let text = input.content_text;
  if (input.operation === "revise_selection") {
    if (
      input.start_utf16 === undefined ||
      input.end_utf16 === undefined ||
      !input.exact_quote
    )
      throw new AppError(400, "SELECTION_REQUIRED", "局部改写需要原始选区");
    validateAnchor(parent.content_text, {
      start_utf16: input.start_utf16,
      end_utf16: input.end_utf16,
      exact_quote: input.exact_quote,
    });
    text =
      parent.content_text.slice(0, input.start_utf16) +
      input.content_text +
      parent.content_text.slice(input.end_utf16);
  }
  const [version] = await tx
    .insert(documentVersions)
    .values({
      session_id: parent.session_id,
      parent_version_id: parent.id,
      content_text: text,
      content_json: textDocument(text),
      revision_source: "human",
    })
    .returning();
  const task = await versionTask(tx, parent.id);
  const [event] = await tx
    .insert(feedbackEvents)
    .values({
      owner_id: OWNER_ID,
      session_id: parent.session_id,
      task_id: task.id,
      event_type: "human_rewrite",
      payload_json: {
        parent_version_id: parent.id,
        document_version_id: version.id,
        operation: input.operation,
        original: parent.content_text,
        replacement: text,
      },
      idempotency_key: key,
    })
    .returning();
  // Never apply old offsets to a new version silently, even when the quote happens to still exist.
  const previous = await tx
    .select()
    .from(annotations)
    .where(eq(annotations.document_version_id, parent.id));
  return {
    version,
    event,
    annotation_reanchoring: previous.map((a) => ({
      annotation_id: a.id,
      status: "needs_reanchor",
      reason: "新版本需要显式重新定位",
    })),
  };
}
