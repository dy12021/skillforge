import { test, expect } from "vitest";
import {
  builtInPatterns,
  detectPatterns,
} from "../packages/core/src/pattern-engine";
import {
  detectionContext,
  ruleConfig,
  scopeApplies,
  scopePriority,
} from "../packages/core/src/rule-types";
const context = detectionContext.parse({ domain: "writing" });
const rules = builtInPatterns().map((config, i) => ({
  id: `fixture-${i}`,
  config,
}));
test("contrast family direct and two variants stay contextual; factual corrections and quotations are exempt", () => {
  for (const text of [
    "真正的努力不是拼时间，而是找对方法。",
    "并非所有困难都需要硬扛，而是要具体分析。",
    "与其一味坚持，不如先问清原因。",
  ]) {
    const hits = detectPatterns(text, rules, context);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].status).toBe("review");
  }
  expect(
    detectPatterns("不是红色按钮，而是右边的蓝色按钮。", rules, context)[0]
      .exception,
  ).toBe("genuine_logical_contrast");
  expect(
    detectPatterns("甲说“不是 A，而是 B”，乙不同意。", rules, context)[0]
      .exception,
  ).toBe("quoted_original");
});
test("colloquial phrases respect dialogue and quote exceptions; UTF16 and Unicode normalization preserve raw spans", () => {
  expect(
    detectPatterns("他犹豫后说：“我认，这次是我错了。”", rules, context)[0]
      .status,
  ).toBe("exempt");
  const report = detectPatterns(
    "🙂我不亏被用来总结研究结果。",
    rules,
    context,
  )[0];
  expect(report.start_utf16).toBe(2);
  expect(report.exact_quote).toBe("我不亏");
  const config = ruleConfig.parse({
      ...rules[1].config,
      match_spec: { kind: "phrase", phrases: ["café"] },
    }),
    text = "🙂cafe\u0301。";
  const hit = detectPatterns(text, [{ id: "nfc", config }], context)[0];
  expect(text.slice(hit.start_utf16, hit.end_utf16)).toBe("cafe\u0301");
});
test("frequency thresholds count actual text, no user-supplied regex; scopes and precedence remain separate", () => {
  const config = ruleConfig.parse({
    ...rules[0].config,
    strength: "limit_frequency",
    match_spec: { kind: "contrast_family", frequency_threshold: 3 },
  });
  const hits = detectPatterns(
    "不是拼时间，而是找方法。不是看态度，而是看行动。不是比大小，而是看细节。不是求全，而是求准。最后停下。",
    [{ id: "frequency", config }],
    context,
  );
  expect(hits).toHaveLength(4);
  expect(hits.every((h) => h.frequency_exceeded)).toBe(true);
  expect(
    detectPatterns(
      "不是拼时间，而是找方法。",
      [{ id: "f", config }],
      context,
    )[0].status,
  ).toBe("exempt");
  expect(
    ruleConfig.safeParse({
      ...config,
      match_spec: { kind: "regex", regex: "(a+)+$" },
    }).success,
  ).toBe(false);
  expect(scopeApplies({ ...config.scope, domain: "dialogue" }, context)).toBe(
    false,
  );
  expect(scopePriority({ ...config.scope, level: "task" })).toBeGreaterThan(
    scopePriority({ ...config.scope, level: "project" }),
  );
});
