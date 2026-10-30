import { z } from "zod";
export const ruleScope = z
  .object({
    level: z.enum(["user", "project", "task"]).default("project"),
    domain: z.enum(["writing", "dialogue", "both"]),
    project_id: z.uuid().nullable().default(null),
    task_id: z.uuid().nullable().default(null),
    genre: z.string().max(80).default(""),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.level !== "user" && !value.project_id)
      ctx.addIssue({
        code: "custom",
        message: "项目/任务规则必须有 project_id",
      });
    if (value.level === "task" && !value.task_id)
      ctx.addIssue({ code: "custom", message: "任务规则必须有 task_id" });
    if (value.level === "user" && (value.project_id || value.task_id))
      ctx.addIssue({ code: "custom", message: "用户规则不可携带项目/任务 ID" });
    if (value.level === "project" && value.task_id)
      ctx.addIssue({ code: "custom", message: "项目规则不可携带 task_id" });
  });
export const matchSpec = z
  .object({
    kind: z.enum(["phrase", "contrast_family", "guidance"]),
    phrases: z.array(z.string().min(1).max(100)).max(30).default([]),
    frequency_threshold: z.number().int().min(1).max(100).default(2),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind === "phrase" && !value.phrases.length)
      ctx.addIssue({ code: "custom", message: "短语模式至少需要一个短语" });
  });
export const exceptionType = z.enum([
  "quoted_original",
  "character_dialogue",
  "genuine_logical_contrast",
  "technical_term",
  "genre_exception",
]);
export const ruleConfig = z
  .object({
    title: z.string().min(1).max(200),
    instruction: z.string().min(1).max(3000),
    level: z
      .enum(["token", "phrase", "syntax", "rhetoric", "paragraph", "discourse"])
      .default("phrase"),
    family: z.string().min(1).max(100),
    match_spec: matchSpec,
    strength: z
      .enum(["forbid", "avoid", "limit_frequency", "suggest_only"])
      .default("suggest_only"),
    scope: ruleScope,
    exceptions: z
      .array(exceptionType)
      .max(5)
      .default([
        "quoted_original",
        "character_dialogue",
        "genuine_logical_contrast",
      ]),
    positive_examples: z.array(z.string().max(600)).max(10).default([]),
    negative_examples: z.array(z.string().max(600)).max(10).default([]),
    rewrite_strategies: z.array(z.string().max(600)).max(10).default([]),
    polarity: z.enum(["prefer", "avoid"]).default("avoid"),
  })
  .strict();
export type RuleConfig = z.infer<typeof ruleConfig>;
export const detectionContext = z
  .object({
    domain: z.enum(["writing", "dialogue"]),
    project_id: z.uuid().optional(),
    task_id: z.uuid().optional(),
    genre: z.string().max(80).default("general"),
    genuine_logical_contrast: z.boolean().default(false),
    technical_terms: z.array(z.string().min(1).max(100)).max(30).default([]),
    preserve_quotes: z.boolean().default(true),
  })
  .strict();
export type DetectionContext = z.infer<typeof detectionContext>;
export function scopeApplies(
  scope: RuleConfig["scope"],
  context: DetectionContext,
) {
  return (
    (scope.domain === "both" || scope.domain === context.domain) &&
    (!scope.genre || scope.genre === context.genre) &&
    (scope.level === "user" ||
      (scope.project_id === context.project_id &&
        (scope.level !== "task" || scope.task_id === context.task_id)))
  );
}
export function scopePriority(scope: RuleConfig["scope"]) {
  return { user: 1, project: 2, task: 3 }[scope.level];
}
