import { and, eq, desc } from "drizzle-orm";
import { z } from "zod";
import { db, OWNER_ID, type Tx } from "./db";
import { linguisticPatterns, patternReviews, jobs } from "./schema";
import { ruleConfig, detectionContext } from "./rule-types";
import { detectPatterns, builtInPatterns } from "./pattern-engine";
import { validateRuleScope, effectiveRules } from "./preferences";
import { getProject } from "./projects";
import { AppError, requireValue } from "./errors";
import {
  agentDetails,
  lockModelJob,
  modelDetails,
  finishModelJob,
  type ProviderProof,
} from "./model-jobs";
export const patternInput = z.object({ config: ruleConfig }).strict();
export const patternUpdate = z
  .object({
    expected_version: z.number().int().positive(),
    config: ruleConfig.optional(),
    active: z.boolean().optional(),
  })
  .strict();
export async function listPatterns() {
  return {
    patterns: await db
      .select()
      .from(linguisticPatterns)
      .where(eq(linguisticPatterns.owner_id, OWNER_ID))
      .orderBy(desc(linguisticPatterns.created_at)),
    reviews: await db
      .select()
      .from(patternReviews)
      .where(eq(patternReviews.owner_id, OWNER_ID))
      .orderBy(desc(patternReviews.created_at)),
    builtins: builtInPatterns(),
  };
}
export async function createPattern(
  tx: Tx,
  input: z.infer<typeof patternInput>,
) {
  await validateRuleScope(tx, input.config);
  return (
    await tx
      .insert(linguisticPatterns)
      .values({ owner_id: OWNER_ID, config_json: input.config })
      .returning()
  )[0];
}
export async function changePattern(
  tx: Tx,
  id: string,
  input: z.infer<typeof patternUpdate>,
) {
  const [old] = await tx
    .select()
    .from(linguisticPatterns)
    .where(
      and(
        eq(linguisticPatterns.id, id),
        eq(linguisticPatterns.owner_id, OWNER_ID),
      ),
    )
    .for("update");
  requireValue(old);
  if (old.version !== input.expected_version)
    throw new AppError(409, "VERSION_CONFLICT", "模式版本已改变，请刷新");
  if (input.config) await validateRuleScope(tx, input.config);
  return (
    await tx
      .update(linguisticPatterns)
      .set({
        config_json: input.config ?? old.config_json,
        active: input.active ?? old.active,
        version: old.version + 1,
      })
      .where(eq(linguisticPatterns.id, id))
      .returning()
  )[0];
}
export const patternCheckInput = z
  .object({
    text: z.string().min(1).max(20000),
    context: detectionContext,
    use_builtins: z.boolean().default(true),
  })
  .strict();
export async function checkPatterns(
  input: z.infer<typeof patternCheckInput>,
  tx: Tx | typeof db = db,
) {
  if (input.context.project_id) await getProject(input.context.project_id, tx);
  const custom = await tx
      .select()
      .from(linguisticPatterns)
      .where(
        and(
          eq(linguisticPatterns.owner_id, OWNER_ID),
          eq(linguisticPatterns.active, true),
        ),
      ),
    preferences = await effectiveRules(input.context, tx);
  const rules = [
    ...custom.map((r) => ({
      id: r.id,
      config: ruleConfig.parse(r.config_json),
    })),
    ...preferences.map((r) => ({ id: r.id, config: r.config })),
    ...(input.use_builtins
      ? builtInPatterns(input.context.domain).map((config, i) => ({
          id: `builtin-${i}`,
          config,
        }))
      : []),
  ];
  const findings = detectPatterns(input.text, rules, input.context);
  return {
    findings,
    summary: {
      matches: findings.length,
      review: findings.filter((f) => f.status === "review").length,
      exempt: findings.filter((f) => f.status === "exempt").length,
    },
    notice: "确定性匹配不是 AI 文本鉴定；保留原文、例外和人工判断",
  };
}
export const patternReviewInput = patternCheckInput
  .extend({
    rule_id: z.string().min(1).max(100),
    start_utf16: z.number().int().nonnegative(),
    end_utf16: z.number().int().positive(),
    decision: z.enum(["false_positive", "confirmed", "exception"]),
    comment: z.string().max(2000).default(""),
  })
  .strict();
export async function reviewPattern(
  tx: Tx,
  input: z.infer<typeof patternReviewInput>,
) {
  const checked = await checkPatterns(input, tx),
    finding = checked.findings.find(
      (f) =>
        f.rule_id === input.rule_id &&
        f.start_utf16 === input.start_utf16 &&
        f.end_utf16 === input.end_utf16,
    );
  requireValue(finding, "原文或模式已改变；请重新检测后保存复核");
  const custom = await tx.query.linguisticPatterns.findFirst({
    where: and(
      eq(
        linguisticPatterns.id,
        z.uuid().safeParse(input.rule_id).success
          ? input.rule_id
          : "00000000-0000-4000-8000-000000000000",
      ),
      eq(linguisticPatterns.owner_id, OWNER_ID),
    ),
  });
  return (
    await tx
      .insert(patternReviews)
      .values({
        owner_id: OWNER_ID,
        pattern_id: custom?.id,
        project_id: input.context.project_id,
        event_type:
          input.decision === "false_positive"
            ? "pattern_false_positive"
            : input.decision === "confirmed"
              ? "pattern_confirmed"
              : "pattern_exception",
        payload_json: {
          text: input.text,
          context: input.context,
          finding,
          decision: input.decision,
          comment: input.comment,
        },
      })
      .returning()
  )[0];
}
export const contextRequest = patternCheckInput
  .extend({ generation_source: z.enum(["agent", "provider"]).default("agent") })
  .strict();
export const contextOutput = z
  .object({
    judgements: z
      .array(
        z
          .object({
            finding_index: z.number().int().nonnegative(),
            verdict: z.enum(["review", "exempt", "uncertain"]),
            exception: z.string().max(100).nullable(),
            reason: z.string().min(1).max(1000),
          })
          .strict(),
      )
      .max(200),
    model_details: agentDetails,
  })
  .strict();
export async function requestContext(
  tx: Tx,
  input: z.infer<typeof contextRequest>,
) {
  const deterministic = await checkPatterns(input, tx);
  if (deterministic.findings.length > 200)
    throw new AppError(
      400,
      "TOO_MANY_FINDINGS",
      "命中过多，请缩短文本或限制检测规则",
    );
  const [job] = await tx
    .insert(jobs)
    .values({
      owner_id: OWNER_ID,
      project_id: input.context.project_id,
      job_type: "pattern_context",
      status: input.generation_source === "agent" ? "awaiting_agent" : "queued",
      payload: {
        ...input,
        deterministic,
        output_contract:
          "judgements: [{finding_index,verdict:review|exempt|uncertain,exception:string|null,reason}], model_details；为每条 finding 提供判断；缺上下文必须 uncertain；引语/必要逻辑关系不得擅自删除",
      },
    })
    .returning();
  return { job, job_id: job.id, deterministic };
}
export async function completeContext(
  tx: Tx,
  id: string,
  raw: unknown,
  proof?: ProviderProof,
) {
  const job = await lockModelJob(tx, id, "pattern_context", proof),
    output = contextOutput.parse(raw),
    base = job.payload.deterministic as Awaited<
      ReturnType<typeof checkPatterns>
    >,
    indices = new Set(output.judgements.map((j) => j.finding_index));
  if (
    indices.size !== output.judgements.length ||
    indices.size !== base.findings.length ||
    [...indices].some((i) => i >= base.findings.length)
  )
    throw new AppError(
      400,
      "INVALID_FINDINGS",
      "语境判断必须恰好对应每条确定性命中",
    );
  return finishModelJob(tx, id, {
    deterministic: base,
    judgements: output.judgements,
    model_details: modelDetails(output.model_details, proof),
    notice: "模型建议仍需人工复核，失败时可继续使用原确定性结果",
  });
}
