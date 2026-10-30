import { describe, expect, test, vi } from "vitest";
import { z } from "zod";
import {
  MockProvider,
  OllamaProvider,
  topicSchema,
} from "../packages/core/src/models";
describe("ModelProvider", () => {
  test("mock outputs are typed, diverse, and explicitly simulated", async () => {
    const provider = new MockProvider();
    const context = {
      kind: "topic" as const,
      mode: "writing" as const,
      count: 5,
      prompt: "",
      granularity: "paragraph",
      target_dimension: "具体细节",
    };
    const topic = await provider.generateStructured(topicSchema, "", context);
    expect(topic.metadata.simulated).toBe(true);
    expect(topic.output.constraints.length).toBeGreaterThan(0);
    const candidates = await provider.generateStructured(
      z.object({ candidates: z.array(z.string()).length(5) }),
      "",
      { ...context, kind: "candidates" },
    );
    expect(new Set(candidates.output.candidates).size).toBe(5);
  });
  test("mock exploration has distinct bounded fixtures and explicit exhaustion, not fabricated infinite generation", async () => {
    const provider = new MockProvider(),
      previous: string[] = [],
      ids: string[] = [];
    const context = {
      kind: "topic" as const,
      mode: "writing" as const,
      count: 3,
      prompt: "",
      granularity: "paragraph",
      target_dimension: "具体",
    };
    for (let i = 0; i < 5; i++) {
      const result = await provider.generateStructured(topicSchema, "", {
        ...context,
        previous_topics: previous,
      });
      expect(result.metadata.simulated).toBe(true);
      previous.push(result.output.prompt);
      ids.push(result.output.generation_id);
    }
    expect(new Set(previous).size).toBe(5);
    expect(new Set(ids).size).toBe(5);
    await expect(
      provider.generateStructured(topicSchema, "", {
        ...context,
        previous_topics: previous,
      }),
    ).rejects.toMatchObject({ code: "MOCK_TOPICS_EXHAUSTED" });
  });
  test("real adapter uses HTTP schema and records actual usage", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        message: { content: '{"answer":"真实接口契约测试"}' },
        eval_count: 12,
      }),
    );
    try {
      const result = await new OllamaProvider().generateStructured(
        z.object({ answer: z.string() }),
        "契约测试",
      );
      expect(result.output.answer).toBe("真实接口契约测试");
      expect(result.metadata.simulated).toBe(false);
      expect(result.metadata.token_usage).toBe(12);
      expect(
        JSON.parse(fetch.mock.calls[0][1]!.body as string).format.type,
      ).toBe("object");
    } finally {
      fetch.mockRestore();
    }
  });
  test("real adapter schema failures never fall back to fixtures", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () =>
        Response.json({ message: { content: '{"wrong":true}' } }),
      );
    try {
      await expect(
        new OllamaProvider().generateStructured(
          z.object({ answer: z.string() }),
          "x",
        ),
      ).rejects.toMatchObject({ code: "MODEL_OUTPUT_INVALID" });
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      fetch.mockRestore();
    }
  });
  test.skipIf(process.env.RUN_REAL_MODEL_TEST !== "true")(
    "real local Ollama opt-in smoke (not evidence of quality improvement)",
    async () => {
      const result = await new OllamaProvider().generateText("只回复“你好”。");
      expect(result.output.length).toBeGreaterThan(0);
      expect(result.metadata.simulated).toBe(false);
    },
    90000,
  );
});
