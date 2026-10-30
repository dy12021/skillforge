import { readFile } from "node:fs/promises";
import { detectPatterns } from "../packages/core/src/pattern-engine";
import { detectionContext, ruleConfig } from "../packages/core/src/rule-types";
const args = process.argv.slice(2),
  file = args.indexOf("--file"),
  textIndex = args.indexOf("--text"),
  mode = args.indexOf("--mode"),
  task = args.indexOf("--task-id");
try {
  const policy = JSON.parse(
      await readFile(
        new URL("../references/check-rules.json", import.meta.url),
        "utf8",
      ),
    ),
    text =
      file >= 0
        ? await readFile(args[file + 1], "utf8")
        : textIndex >= 0
          ? args[textIndex + 1]
          : null;
  if (!text)
    throw new Error(
      "使用 node scripts/check-patterns.mjs --file 文本文件 或 --text 文本 [--mode writing|dialogue]",
    );
  if (text.length > 20000) throw new Error("文本超过 20000 UTF-16 字符");
  const context = detectionContext.parse({
      ...policy.context,
      ...(mode >= 0 ? { domain: args[mode + 1] } : {}),
      ...(task >= 0 ? { task_id: args[task + 1] } : {}),
    }),
    rules = policy.rules.map((r: { id: string; config: unknown }) => ({
      id: r.id,
      config: ruleConfig.parse(r.config),
    }));
  console.log(
    JSON.stringify(
      {
        offline: true,
        findings: detectPatterns(text, rules, context),
        notice:
          "仅静态匹配，不证明 AI 文本或语义等价；必要否定、事实与引语保留",
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      error: error instanceof Error ? error.message : "检查失败",
    }),
  );
  process.exitCode = 1;
}
