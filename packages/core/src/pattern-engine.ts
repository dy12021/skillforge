import type { RuleConfig, DetectionContext } from "./rule-types";
import { scopeApplies } from "./rule-types";
export type Finding = {
  rule_id: string;
  start_utf16: number;
  end_utf16: number;
  exact_quote: string;
  context: string;
  family: string;
  strength: string;
  status: "review" | "exempt";
  exception: string | null;
  reason: string;
  occurrences: number;
  frequency_exceeded: boolean;
  method: "deterministic";
};
function normalize(text: string) {
  let normalized = "";
  const starts: number[] = [],
    ends: number[] = [];
  for (const item of new Intl.Segmenter("zh", {
    granularity: "grapheme",
  }).segment(text)) {
    const part = item.segment.normalize("NFC");
    normalized += part;
    for (let i = 0; i < part.length; i++) {
      starts.push(item.index);
      ends.push(item.index + item.segment.length);
    }
  }
  return { normalized, starts, ends };
}
function quotedRanges(text: string) {
  const result: { start: number; end: number }[] = [];
  const pairs: Record<string, string> = {
    "“": "”",
    "「": "」",
    "『": "』",
    '"': '"',
  };
  let open = -1,
    close = "";
  for (let i = 0; i < text.length; i++) {
    if (open >= 0) {
      if (text[i] === close) {
        result.push({ start: open, end: i + 1 });
        open = -1;
      }
    } else if (pairs[text[i]]) {
      open = i;
      close = pairs[text[i]];
    }
  }
  return result;
}
export function detectPatterns(
  text: string,
  rules: { id: string; config: RuleConfig }[],
  context: DetectionContext,
): Finding[] {
  const { normalized, starts, ends } = normalize(text),
    quotes = quotedRanges(text),
    result: Finding[] = [];
  for (const rule of rules) {
    const c = rule.config;
    if (!scopeApplies(c.scope, context) || c.match_spec.kind === "guidance")
      continue;
    const ranges: { start: number; end: number }[] = [];
    if (c.match_spec.kind === "phrase")
      for (const phrase of c.match_spec.phrases) {
        const needle = phrase.normalize("NFC");
        let from = 0,
          index = 0;
        while ((index = normalized.indexOf(needle, from)) >= 0) {
          ranges.push({
            start: starts[index],
            end: ends[index + needle.length - 1],
          });
          from = index + 1;
        }
      }
    else
      for (const regex of [
        /(?:并不是|不是|并非|不在于|并不在于)[^。！？\n”」』"]{1,100}?(?:而是|而在于)[^。！？\n”」』"]{1,100}/gu,
        /与其[^。！？\n”」』"]{1,100}?不如[^。！？\n”」』"]{1,100}/gu,
      ])
        for (const match of normalized.matchAll(regex))
          ranges.push({
            start: starts[match.index],
            end: ends[match.index + match[0].length - 1],
          });
    const unique = [
      ...new Map(ranges.map((r) => [`${r.start}:${r.end}`, r])).values(),
    ].sort((a, b) => a.start - b.start);
    const frequency = unique.length > c.match_spec.frequency_threshold;
    for (const range of unique) {
      const quote = text.slice(range.start, range.end),
        before = text.slice(Math.max(0, range.start - 60), range.start),
        isQuoted = quotes.some(
          (q) => q.start <= range.start && q.end >= range.end,
        ),
        dialogue =
          context.domain === "dialogue" ||
          (isQuoted &&
            /(?:说|问|答|喊|回复|道)[：:，,]?\s*[“「『"]?[^”」』"]*$/u.test(
              before,
            ));
      let exception: string | null = null;
      if (
        isQuoted &&
        (context.preserve_quotes || c.exceptions.includes("quoted_original"))
      )
        exception = "quoted_original";
      else if (dialogue && c.exceptions.includes("character_dialogue"))
        exception = "character_dialogue";
      else if (
        c.exceptions.includes("genuine_logical_contrast") &&
        (context.genuine_logical_contrast ||
          (/按钮/u.test(quote) && /红色|蓝色|右边|左边/u.test(quote)))
      )
        exception = "genuine_logical_contrast";
      else if (
        c.exceptions.includes("technical_term") &&
        context.technical_terms.some((term) => quote.includes(term))
      )
        exception = "technical_term";
      const limited = c.strength === "limit_frequency" && !frequency;
      result.push({
        rule_id: rule.id,
        start_utf16: range.start,
        end_utf16: range.end,
        exact_quote: quote,
        context: text.slice(
          Math.max(0, range.start - 80),
          Math.min(text.length, range.end + 80),
        ),
        family: c.family,
        strength: c.strength,
        status: exception || limited ? "exempt" : "review",
        exception,
        reason: exception
          ? `保留：命中 ${exception} 例外`
          : limited
            ? `出现 ${unique.length} 次，未超过阈值 ${c.match_spec.frequency_threshold}`
            : `匹配用户模式；需上下文复核，不能据此断言是 AI 文本${frequency ? `；出现 ${unique.length} 次，超过阈值 ${c.match_spec.frequency_threshold}` : ""}`,
        occurrences: unique.length,
        frequency_exceeded: frequency,
        method: "deterministic",
      });
    }
  }
  return result;
}
export function builtInPatterns(
  domain: "writing" | "dialogue" = "writing",
): RuleConfig[] {
  const base = {
    scope: {
      level: "user" as const,
      domain,
      project_id: null,
      task_id: null,
      genre: "",
    },
    exceptions: [
      "quoted_original",
      "character_dialogue",
      "genuine_logical_contrast",
    ] as RuleConfig["exceptions"],
    positive_examples: [],
    negative_examples: [],
    rewrite_strategies: ["先判断是否有真实逻辑区分；必要否定与引语原样保留"],
    polarity: "avoid" as const,
    strength: "suggest_only" as const,
  };
  return [
    {
      ...base,
      title: "对立转折句式家族（需语境判断）",
      instruction: "检查机械转折；保留必要事实纠正与引语",
      level: "syntax",
      family: "contrast",
      match_spec: {
        kind: "contrast_family",
        phrases: [],
        frequency_threshold: 2,
      },
    },
    {
      ...base,
      title: "口语短语的语境",
      instruction: "检查我认/我不亏是否适合当前文体；人物对白可保留",
      level: "phrase",
      family: "colloquial",
      match_spec: {
        kind: "phrase",
        phrases: ["我认", "我不亏"],
        frequency_threshold: 2,
      },
    },
  ];
}
