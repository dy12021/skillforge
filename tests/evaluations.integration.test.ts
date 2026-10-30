import { beforeAll, afterAll, test, expect, vi } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool, OWNER_ID, WORKSPACE_ID } from "../packages/core/src/db";
import {
  workspaces,
  evaluationItems,
  evaluationTasks,
  evaluationVotes,
  skillBuilds,
} from "../packages/core/src/schema";
import { GET, POST, PATCH } from "../apps/web/app/api/[...path]/route";
import { preferenceMetrics } from "../packages/core/src/evaluations";
import { activeFeedbackEvidence } from "../packages/core/src/preferences";
import { MockProvider } from "../packages/core/src/models";
import { runOneJob } from "../packages/core/src/jobs";
import { eq } from "drizzle-orm";
beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./migrations" });
  await db
    .insert(workspaces)
    .values({ id: WORKSPACE_ID, owner_id: OWNER_ID, name: "test" })
    .onConflictDoNothing();
});
afterAll(() => pool.end());
async function call(
  path: string,
  body?: unknown,
  method = "POST",
  key = crypto.randomUUID(),
) {
  const r = await (
    body === undefined ? GET : method === "PATCH" ? PATCH : POST
  )(
    new Request("http://localhost/api/" + path, {
      method: body === undefined ? "GET" : method,
      headers: { "Idempotency-Key": key },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
  return { status: r.status, ...(await r.json()) };
}
async function setup() {
  const project = (
      await call("projects", {
        name: "盲测 fixture " + crypto.randomUUID().slice(0, 8),
        domain: "writing",
      })
    ).data,
    rule = (
      await call("preferences", {
        config: {
          title: "测试规则具体表达",
          instruction: "用可观察动作替代宏观总结，保留事实",
          family: "eval-" + project.id,
          match_spec: { kind: "phrase", phrases: ["无限可能"] },
          scope: {
            level: "project",
            project_id: project.id,
            domain: "writing",
          },
          strength: "avoid",
        },
      })
    ).data;
  await call(
    `preferences/${rule.id}`,
    { action: "confirm", expected_version: 1 },
    "PATCH",
  );
  const build = (
    await call("skills/builds", {
      project_id: project.id,
      type: "personalized-writing",
    })
  ).data.build;
  return { project, build, rule };
}
function generated(request: {
  generation_request: { holdouts: { task_id: string; prompt: string }[] };
}) {
  return {
    pairs: request.generation_request.holdouts.map((t, i) => ({
      task_id: t.task_id,
      baseline: `测试普通版本${i}：${t.prompt}`,
      personalized: `测试应用规则版本${i}：${t.prompt}`,
    })),
    model_details: { agent_name: "isolated evaluation fixture, not real AI" },
  };
}
test("five fixed holdouts, durable hidden maps, immutable votes and test-only reporting after all votes", async () => {
  const { project, build } = await setup(),
    created = (
      await call("evaluations", { build_id: build.id, test_run: true })
    ).data;
  expect(created.generation_request.holdouts).toHaveLength(5);
  const output = generated(created);
  expect((await call(`jobs/${created.job_id}/complete`, output)).status).toBe(
    200,
  );
  let view = (await call(`evaluations/${created.run.id}`)).data;
  expect(view.items).toHaveLength(5);
  expect(JSON.stringify(view)).not.toMatch(
    /left_source|right_source|model_details|baseline_pattern_hits/u,
  );
  expect(
    (await call(`evaluations/${created.run.id}/results`)).data.metrics,
  ).toBeNull();
  expect(
    (await call(`evaluations/${created.run.id}/results`)).data.mapping,
  ).toBeNull();
  const { exportWorkspace } = await import("../packages/core/src/export");
  const backup = await exportWorkspace(),
    exportedRun = backup.evaluations.find(
      (r) => r.state.run.id === created.run.id,
    );
  expect(exportedRun?.results.mapping).toBeNull();
  expect(JSON.stringify(exportedRun)).not.toContain("left_source");
  expect(
    JSON.stringify((await call(`jobs/${created.job_id}`)).data.result),
  ).not.toContain("baseline");
  expect(
    (await call(`evaluations/${created.run.id}`)).data.items.map(
      (i: { left: string }) => i.left,
    ),
  ).toEqual(view.items.map((i: { left: string }) => i.left));
  const before = await db.transaction((tx) =>
    activeFeedbackEvidence(tx, project.id),
  );
  const choices = ["left", "right", "tie", "both_bad", "left"];
  for (let i = 0; i < 5; i++) {
    const key = crypto.randomUUID(),
      body = {
        item_id: view.items[i].item_id,
        vote: choices[i],
        origin: "human",
        comment: "自动化测试；不作为真人改善证据",
        semantic_review: i === 0 ? "pass" : "not_reviewed",
      },
      first = await call(
        `evaluations/${created.run.id}/votes`,
        body,
        "POST",
        key,
      ),
      retry = await call(
        `evaluations/${created.run.id}/votes`,
        body,
        "POST",
        key,
      );
    expect(first.status).toBe(200);
    expect(first.data.origin).toBe("test");
    expect(retry.data.vote_id).toBe(first.data.vote_id);
    expect(
      (await call(`evaluations/${created.run.id}/votes`, body)).status,
    ).toBe(409);
    if (i < 4)
      expect(
        (await call(`evaluations/${created.run.id}/results`)).data.mapping,
      ).toBeNull();
  }
  const results = (await call(`evaluations/${created.run.id}/results`)).data;
  expect(results.status).toBe("awaiting_human_evidence");
  expect(results.human_sample_count).toBe(0);
  expect(results.metrics).toBeNull();
  expect(results.test_sample_count).toBe(5);
  expect(results.test_metrics.ties).toBe(1);
  expect(results.test_metrics.both_bad).toBe(1);
  expect(results.mapping).toHaveLength(5);
  expect(results.diagnostics.baseline_pattern_hits).toBe(0);
  expect(results.diagnostics.false_positive_rate).toBeNull();
  expect(results.diagnostics.revision_acceptance_rate).toBeNull();
  const [stored] = await db
    .select()
    .from(evaluationVotes)
    .where(eq(evaluationVotes.run_id, created.run.id));
  await expect(
    db
      .update(evaluationVotes)
      .set({ vote: "right" })
      .where(eq(evaluationVotes.id, stored.id)),
  ).rejects.toThrow();
  const [item] = await db
    .select()
    .from(evaluationItems)
    .where(eq(evaluationItems.run_id, created.run.id));
  await expect(
    db
      .update(evaluationItems)
      .set({ left_source: "personalized" })
      .where(eq(evaluationItems.id, item.id)),
  ).rejects.toThrow();
  expect(
    (await db.query.skillBuilds.findFirst({
      where: eq(skillBuilds.id, build.id),
    }))!.content_hash,
  ).toBe(build.content_hash);
  view = (await call(`evaluations/${created.run.id}`)).data;
  expect(view.voted_count).toBe(5);
  const after = await db.transaction((tx) =>
    activeFeedbackEvidence(tx, project.id),
  );
  expect(after.map((e) => e.id)).toEqual(before.map((e) => e.id));
});
test("reject incomplete pairs, reused training prompts, duplicate holdouts and attempts to train reserved tasks", async () => {
  const { project, build } = await setup(),
    created = (await call("evaluations", { build_id: build.id })).data,
    output = generated(created),
    bad = { ...output, pairs: [...output.pairs.slice(1), output.pairs[1]] };
  expect((await call(`jobs/${created.job_id}/complete`, bad)).error.code).toBe(
    "EVALUATION_TASK_MISMATCH",
  );
  const prompt = created.generation_request.holdouts[0].prompt;
  expect(
    (
      await call("sessions", {
        project_id: project.id,
        mode: "writing",
        source: "manual",
        prompt,
        candidate_count: 2,
      })
    ).error.code,
  ).toBe("HOLDOUT_RESERVED");
  expect(
    (
      await call("evaluations", {
        build_id: build.id,
        holdouts: Array.from({ length: 5 }, () => ({
          title: "repeat",
          prompt: "same",
        })),
      })
    ).error.code,
  ).toBe("DUPLICATE_HOLDOUT");
  const s = (
    await call("sessions", {
      project_id: project.id,
      mode: "writing",
      source: "manual",
      prompt: "训练题：不得用于盲测",
      candidate_count: 2,
    })
  ).data;
  await call(`jobs/${s.job_id}/complete`, {
    topic: {
      title: "train",
      prompt: "训练题：不得用于盲测",
      genre: "narrative",
      target_dimension: "具体",
      difficulty: "normal",
      constraints: [],
      generation_id: "test",
    },
    candidates: ["测试候选甲", "测试候选乙"],
    model_details: { agent_name: "test" },
  });
  const holdouts = created.generation_request.holdouts.map(
    (t: { prompt: string }, i: number) => ({
      title: "heldout" + i,
      prompt: i === 0 ? "训练题：不得用于盲测" : t.prompt,
    }),
  );
  expect(
    (await call("evaluations", { build_id: build.id, holdouts })).error.code,
  ).toBe("HOLDOUT_LEAKAGE");
  expect(
    (
      await call("evaluations", {
        build_id: build.id,
        holdouts: holdouts.slice(0, 4),
      })
    ).status,
  ).toBe(400);
  const [t] = await db
    .select()
    .from(evaluationTasks)
    .where(eq(evaluationTasks.run_id, created.run.id));
  await expect(
    db
      .update(evaluationTasks)
      .set({ prompt: "tamper" })
      .where(eq(evaluationTasks.id, t.id)),
  ).rejects.toThrow();
});
test("provider uses separate baseline and immutable Skill prompts; mock provenance never becomes improvement evidence", async () => {
  const { build, rule } = await setup(),
    created = (
      await call("evaluations", {
        build_id: build.id,
        generation_source: "provider",
        test_run: true,
      })
    ).data;
  await call(
    `preferences/${rule.id}`,
    {
      action: "edit",
      expected_version: 2,
      config: { ...rule.config_json, instruction: "改后的规则不属于被测版本" },
    },
    "PATCH",
  );
  const spy = vi.spyOn(MockProvider.prototype, "generateStructured");
  try {
    for (let i = 0; i < 8; i++) {
      await runOneJob();
      if ((await call(`jobs/${created.job_id}`)).data.status === "succeeded")
        break;
    }
    const calls = spy.mock.calls.filter((c) => c[2].kind === "evaluation");
    expect(calls).toHaveLength(10);
    for (const call of calls) {
      if (call[2].evaluation_side === "baseline")
        expect(call[1]).not.toContain("用可观察动作替代宏观总结");
      else expect(call[1]).toContain("用可观察动作替代宏观总结");
      expect(call[1]).not.toContain("改后的规则不属于被测版本");
    }
  } finally {
    spy.mockRestore();
  }
  const view = (await call(`evaluations/${created.run.id}`)).data;
  expect(view.simulated).toBe(true);
  expect(
    view.items.every((i: { left: string; right: string }) => i.left && i.right),
  ).toBe(true);
  expect(
    (await call(`evaluations/${created.run.id}/results`)).data.metrics,
  ).toBeNull();
});
test("win-rate math separates ties/rejections and unknown semantic review without invented samples", () => {
  const result = preferenceMetrics([
    { vote: "left", left_source: "personalized", semantic_review: "pass" },
    { vote: "right", left_source: "personalized", semantic_review: "risk" },
    { vote: "tie", left_source: "baseline" },
    { vote: "both_bad", left_source: "personalized" },
  ]);
  expect(result.sample_count).toBe(4);
  expect(result.preference_win_rate).toBe(0.5);
  expect(result.ties).toBe(1);
  expect(result.both_bad).toBe(1);
  expect(result.semantic_pass_rate).toBe(0.5);
  expect(preferenceMetrics([]).preference_win_rate).toBeNull();
});
