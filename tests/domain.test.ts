import { describe, expect, test } from "vitest";
import {
  feedbackInput,
  validateComparison,
} from "../packages/core/src/feedback";
import { validateAnchor, quoteHash } from "../packages/core/src/annotations";
import { sessionInput } from "../packages/core/src/training";
const ids = Array.from({ length: 5 }, () => crypto.randomUUID());
const base = {
  session_id: crypto.randomUUID(),
  task_id: crypto.randomUUID(),
  candidate_ids: ids,
  displayed_order: ids,
};
describe("original feedback semantics", () => {
  test("approve_many retains unordered approval; reject_all has no winner", () => {
    const many = feedbackInput.parse({
      ...base,
      feedback_mode: "approve_many",
      approved_ids: [ids[1], ids[2], ids[4]],
    });
    expect(() => validateComparison(many)).not.toThrow();
    expect(many.ranking_groups).toBeNull();
    const reject = feedbackInput.parse({
      ...base,
      feedback_mode: "reject_all",
    });
    expect(() => validateComparison(reject)).not.toThrow();
    expect(reject.approved_ids).toEqual([]);
  });
  test("full ranking preserves ties and rejects duplicates / omissions", () => {
    const valid = feedbackInput.parse({
      ...base,
      feedback_mode: "full_ranking",
      ranking_groups: [[ids[1], ids[4]], [ids[2]], [ids[0], ids[3]]],
    });
    expect(() => validateComparison(valid)).not.toThrow();
    expect(() =>
      validateComparison({
        ...valid,
        ranking_groups: [[ids[0]], [ids[0], ...ids.slice(1)]],
      }),
    ).toThrow();
  });
  test("comments and human edits do not require a winner", () => {
    expect(() =>
      validateComparison(
        feedbackInput.parse({
          ...base,
          feedback_mode: null,
          comments: [{ candidate_id: ids[1], text: "更具体" }],
          human_edits: [
            { candidate_id: ids[2], original: "原文", replacement: "改文" },
          ],
        }),
      ),
    ).not.toThrow();
  });
  test("best_one requires exactly one; empty feedback is invalid", () => {
    expect(() =>
      validateComparison(
        feedbackInput.parse({
          ...base,
          feedback_mode: "best_one",
          approved_ids: [ids[1], ids[2]],
        }),
      ),
    ).toThrow();
    expect(() => validateComparison(feedbackInput.parse(base))).toThrow();
  });
});
describe("UTF-16 and immutable version anchors", () => {
  const text =
    "他没有立刻回答。真正的成长，不是学会隐藏情绪，而是学会与自己和解。🙂";
  test("Chinese span and emoji use UTF-16 units", () => {
    const quote = "不是学会隐藏情绪，而是学会与自己和解",
      start = text.indexOf(quote);
    expect(
      validateAnchor(text, {
        start_utf16: start,
        end_utf16: start + quote.length,
        exact_quote: quote,
      }),
    ).toBe(quoteHash(quote));
    expect(
      validateAnchor(text, {
        start_utf16: text.length - 2,
        end_utf16: text.length,
        exact_quote: "🙂",
      }),
    ).toBe(quoteHash("🙂"));
    expect(() =>
      validateAnchor(text, {
        start_utf16: text.length - 1,
        end_utf16: text.length,
        exact_quote: text.slice(-1),
      }),
    ).toThrow();
  });
  test("same-length unrelated text does not inherit old offsets", () => {
    expect(() =>
      validateAnchor("同长度的另一处文本🙂", {
        start_utf16: 0,
        end_utf16: 3,
        exact_quote: "他没有",
      }),
    ).toThrow();
  });
  test.each([2, 3, 5, 8])("N=%i accepted; out-of-range rejected", (count) => {
    const config = {
      project_id: crypto.randomUUID(),
      mode: "writing",
      candidate_count: count,
    };
    expect(sessionInput.safeParse(config).success).toBe(true);
    expect(
      sessionInput.safeParse({ ...config, candidate_count: 9 }).success,
    ).toBe(false);
  });
});
