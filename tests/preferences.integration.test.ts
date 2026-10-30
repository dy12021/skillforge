import { beforeAll, afterAll, test, expect, vi } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool, OWNER_ID, WORKSPACE_ID } from "../packages/core/src/db";
import { workspaces, ruleHistory } from "../packages/core/src/schema";
import { GET, POST, PATCH } from "../apps/web/app/api/[...path]/route";
import { ruleConfig, detectionContext } from "../packages/core/src/rule-types";
import { effectiveRules } from "../packages/core/src/preferences";
import { runOneJob } from "../packages/core/src/jobs";
import { eq } from "drizzle-orm";
import { MockProvider } from "../packages/core/src/models";
import { AppError } from "../packages/core/src/errors";
beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./migrations" });
  await db
    .insert(workspaces)
    .values({ id: WORKSPACE_ID, owner_id: OWNER_ID, name: "test" })
    .onConflictDoNothing();
});
afterAll(async () => {
  await pool.end();
});
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
function config(
  project_id: string,
  title = "避免空泛开头",
  instruction = "写作从具体可观察细节开始",
  family = "opening-" + project_id,
) {
  return ruleConfig.parse({
    title,
    instruction,
    family,
    match_spec: { kind: "phrase", phrases: ["无限可能"] },
    scope: { domain: "writing", level: "project", project_id },
    strength: "avoid",
    positive_examples: ["店主蹲下给轮胎打气。"],
    negative_examples: ["拥抱无限可能。"],
  });
}
async function feedbackProject() {
  const project = (
      await call("projects", { name: "偏好证据测试", domain: "writing" })
    ).data,
    created = (
      await call("sessions", {
        project_id: project.id,
        mode: "writing",
        candidate_count: 2,
      })
    ).data;
  await call(`jobs/${created.job_id}/complete`, {
    topic: {
      title: "测试",
      prompt: "描写修车铺",
      genre: "narrative",
      target_dimension: "具体",
      difficulty: "normal",
      constraints: [],
      generation_id: crypto.randomUUID(),
    },
    candidates: ["修车铺还亮着灯，店主在打气。", "拥抱无限可能。"],
    model_details: { agent_name: "test fixture" },
  });
  const snap = (await call(`sessions/${created.session.id}`)).data;
  await call("feedback", {
    session_id: created.session.id,
    task_id: snap.tasks[0].id,
    candidate_ids: snap.candidates.map((c: { id: string }) => c.id),
    displayed_order: snap.candidate_sets[0].shuffled_order_json,
    feedback_mode: "reject_all",
    comments: [
      { candidate_id: snap.candidates[1].id, text: "不要空泛结论，测试反馈" },
    ],
  });
  return {
    project,
    snapshot: (await call(`sessions/${created.session.id}`)).data,
  };
}
test("actual evidence is required; proposals cannot invent IDs, duplicate support or broaden scope; withdrawn feedback cannot confirm", async () => {
  const { project, snapshot } = await feedbackProject();
  const request = (
      await call("preferences/propose", { project_id: project.id })
    ).data,
    evidence = request.job.payload.evidence;
  const proposal = {
    config: config(project.id),
    evidence_ids: evidence.map((e: { id: string }) => e.id),
    counter_evidence_ids: [],
    rationale: "根据拒绝与具体评语提出，不能创造正向胜者",
    confidence_summary: "两条测试反馈，仅支持此项目的待确认假设",
  };
  expect(
    (
      await call(`jobs/${request.job_id}/complete`, {
        proposals: [
          {
            ...proposal,
            evidence_ids: [crypto.randomUUID(), crypto.randomUUID()],
          },
        ],
        model_details: { agent_name: "test harness" },
      })
    ).error.code,
  ).toBe("INVALID_EVIDENCE");
  expect(
    (
      await call(`jobs/${request.job_id}/complete`, {
        proposals: [
          { ...proposal, evidence_ids: [evidence[0].id, evidence[0].id] },
        ],
        model_details: { agent_name: "test harness" },
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await call(`jobs/${request.job_id}/complete`, {
        proposals: [
          {
            ...proposal,
            config: {
              ...proposal.config,
              scope: { level: "user", domain: "both" },
            },
          },
        ],
        model_details: { agent_name: "test harness" },
      })
    ).error.code,
  ).toBe("PROPOSAL_SCOPE");
  expect(
    (
      await call(`jobs/${request.job_id}/complete`, {
        proposals: [proposal],
        model_details: { agent_name: "test harness" },
      })
    ).status,
  ).toBe(200);
  const row = (await call(`preferences?project_id=${project.id}`)).data
    .rules[0];
  expect(row.status).toBe("proposed");
  expect(row.model_details_json.provenance).toBe("agent-self-reported");
  expect(
    (
      await effectiveRules(
        detectionContext.parse({ domain: "writing", project_id: project.id }),
      )
    ).some((r) => r.id === row.id),
  ).toBe(false);
  await call("feedback/undo", {
    event_id: snapshot.feedback_events[0].id,
    reason: "撤销测试证据",
  });
  expect(
    (
      await call(
        `preferences/${row.id}`,
        { action: "confirm", expected_version: row.version },
        "PATCH",
      )
    ).error.code,
  ).toBe("EVIDENCE_WITHDRAWN");
  const insufficient = await call("preferences/propose", {
    project_id: project.id,
  });
  expect(insufficient.error.code).toBe("INSUFFICIENT_EVIDENCE");
});
test("manual rules, explicit conflicts, precedence, domain separation and immutable version history", async () => {
  const p = (
    await call("projects", { name: "规则作用域测试", domain: "writing" })
  ).data;
  const first = (await call("preferences", { config: config(p.id) })).data;
  const c = (
    await call(
      `preferences/${first.id}`,
      { action: "confirm", expected_version: 1 },
      "PATCH",
    )
  ).data;
  expect(c.status).toBe("confirmed");
  const second = (
    await call("preferences", {
      config: config(p.id, "偏好宏观开头", "先说明主题，再展开细节"),
    })
  ).data;
  expect(
    (
      await call(
        `preferences/${second.id}`,
        { action: "confirm", expected_version: 1 },
        "PATCH",
      )
    ).error.code,
  ).toBe("RULE_CONFLICT");
  const resolved = await call(
    `preferences/${second.id}`,
    {
      action: "confirm",
      expected_version: 1,
      resolve_conflict_ids: [first.id],
    },
    "PATCH",
  );
  expect(resolved.status).toBe(200);
  expect(
    (
      await call(
        `preferences/${second.id}`,
        { action: "archive", expected_version: 1 },
        "PATCH",
      )
    ).status,
  ).toBe(409);
  const globalConfig = config(p.id, "用户级偏好", "具体开头优先");
  globalConfig.scope = {
    level: "user",
    domain: "writing",
    project_id: null,
    task_id: null,
    genre: "",
  };
  const user = (await call("preferences", { config: globalConfig })).data;
  await call(
    `preferences/${user.id}`,
    { action: "confirm", expected_version: 1 },
    "PATCH",
  );
  const effective = await effectiveRules(
    detectionContext.parse({ domain: "writing", project_id: p.id }),
  );
  expect(effective.some((r) => r.id === second.id)).toBe(true);
  expect(effective.some((r) => r.id === user.id)).toBe(false);
  expect(
    (
      await effectiveRules(
        detectionContext.parse({ domain: "dialogue", project_id: p.id }),
      )
    ).some((r) => r.id === second.id || r.id === user.id),
  ).toBe(false);
  const history = (await call(`preferences/${first.id}/history`)).data;
  expect(history.map((r: { version: number }) => r.version)).toEqual([1, 2, 3]);
  await expect(
    db
      .update(ruleHistory)
      .set({ event_type: "tamper" })
      .where(eq(ruleHistory.id, history[0].id)),
  ).rejects.toThrow();
  await call(
    `preferences/${second.id}`,
    { action: "archive", expected_version: resolved.data.version },
    "PATCH",
  );
  expect(
    (
      await effectiveRules(
        detectionContext.parse({ domain: "writing", project_id: p.id }),
      )
    ).some((r) => r.id === user.id),
  ).toBe(true);
  await call(
    `preferences/${user.id}`,
    { action: "archive", expected_version: 2 },
    "PATCH",
  );
});
test("pattern reviews persist raw spans, custom strength edits are versioned, and mock semantic output remains uncertain", async () => {
  const p = (
      await call("projects", { name: "模式复核测试", domain: "writing" })
    ).data,
    input = {
      text: "不是红色按钮，而是右边的蓝色按钮。真正的努力不是拼时间，而是找方法。",
      context: { domain: "writing", project_id: p.id },
    };
  const checked = await call("patterns/check", input);
  expect(checked.data.findings).toHaveLength(2);
  const finding = checked.data.findings[1];
  const key = crypto.randomUUID(),
    review = {
      ...input,
      rule_id: finding.rule_id,
      start_utf16: finding.start_utf16,
      end_utf16: finding.end_utf16,
      decision: "false_positive",
      comment: "测试：这里有必要对比",
    };
  const saved = await call("patterns/review", review, "POST", key),
    again = await call("patterns/review", review, "POST", key);
  expect(saved.data.id).toBe(again.data.id);
  expect(saved.data.payload_json.finding.exact_quote).toBe(finding.exact_quote);
  const pattern = (await call("patterns", { config: config(p.id) })).data;
  expect(
    (
      await call(
        `patterns/${pattern.id}`,
        {
          expected_version: 1,
          config: { ...pattern.config_json, strength: "limit_frequency" },
        },
        "PATCH",
      )
    ).data.version,
  ).toBe(2);
  expect(
    (
      await call(
        `patterns/${pattern.id}`,
        { expected_version: 1, active: false },
        "PATCH",
      )
    ).status,
  ).toBe(409);
  const contextJob = (
    await call("patterns/context", { ...input, generation_source: "provider" })
  ).data;
  for (let i = 0; i < 8; i++) {
    await runOneJob();
    if ((await call(`jobs/${contextJob.job_id}`)).data.status === "succeeded")
      break;
  }
  const result = (await call(`jobs/${contextJob.job_id}`)).data.result;
  expect(result.model_details.simulated).toBe(true);
  expect(
    result.judgements.every(
      (j: { verdict: string }) => j.verdict === "uncertain",
    ),
  ).toBe(true);
  expect(result.deterministic.findings).toHaveLength(2);
  const all = (await call("patterns")).data;
  expect(all.reviews.some((r: { id: string }) => r.id === saved.data.id)).toBe(
    true,
  );
});
test("task requirements override project guidance; confirmed rules reach generation and revision regression reports", async () => {
  const { project, snapshot } = await feedbackProject(),
    projectRule = (await call("preferences", { config: config(project.id) }))
      .data;
  await call(
    `preferences/${projectRule.id}`,
    { action: "confirm", expected_version: 1 },
    "PATCH",
  );
  const taskConfig = config(
    project.id,
    "任务例外",
    "此任务允许分析空泛表达，保留待分析原句",
  );
  taskConfig.scope = {
    ...taskConfig.scope,
    level: "task",
    task_id: snapshot.tasks[0].id,
  };
  const taskRule = (await call("preferences", { config: taskConfig })).data;
  expect(
    (
      await call(
        `preferences/${taskRule.id}`,
        { action: "confirm", expected_version: 1 },
        "PATCH",
      )
    ).status,
  ).toBe(200);
  const effective = await effectiveRules(
    detectionContext.parse({
      domain: "writing",
      project_id: project.id,
      task_id: snapshot.tasks[0].id,
    }),
  );
  expect(effective.some((r) => r.id === taskRule.id)).toBe(true);
  expect(effective.some((r) => r.id === projectRule.id)).toBe(false);
  const request = (
    await call("revisions", {
      document_version_id: snapshot.document_versions[0].id,
      operation: "revise_document",
      instruction: "检查规则回归",
      generation_source: "agent",
    })
  ).data;
  expect(
    request.generation_request.confirmed_rules.some(
      (r: { id: string }) => r.id === taskRule.id,
    ),
  ).toBe(true);
  await call(`jobs/${request.job_id}/complete`, {
    replacement: "此处分析无限可能这种表达。",
    rationale: "自动化测试",
    model_details: { agent_name: "test fixture" },
  });
  const revision = (await call(`revisions?session_id=${snapshot.session.id}`))
    .data[0];
  expect(
    revision.semantic_warnings.some((w: string) => w.includes("已确认模式")),
  ).toBe(true);
  const next = (
    await call("sessions", {
      project_id: project.id,
      mode: "writing",
      candidate_count: 2,
    })
  ).data;
  expect(
    next.generation_request.confirmed_rules.some(
      (r: { id: string }) => r.id === projectRule.id,
    ),
  ).toBe(true);
  expect(
    next.generation_request.confirmed_rules.some(
      (r: { id: string }) => r.id === taskRule.id,
    ),
  ).toBe(false);
});
test("provider errors retry finitely and preserve deterministic evidence, without fabricated contextual success", async () => {
  const request = (
    await call("patterns/context", {
      text: "真正努力不是拼时间，而是找方法。",
      context: { domain: "writing" },
      generation_source: "provider",
    })
  ).data;
  const spy = vi
    .spyOn(MockProvider.prototype, "generateStructured")
    .mockRejectedValue(
      new AppError(502, "TEST_PROVIDER_OFFLINE", "isolated failure fixture"),
    );
  try {
    for (let i = 0; i < 8; i++) {
      await runOneJob();
      if ((await call(`jobs/${request.job_id}`)).data.status === "failed")
        break;
    }
  } finally {
    spy.mockRestore();
  }
  const failed = (await call(`jobs/${request.job_id}`)).data;
  expect(failed.status).toBe("failed");
  expect(failed.attempts).toBe(2);
  expect(failed.result).toBeNull();
  expect(failed.payload.deterministic.findings.length).toBeGreaterThan(0);
});
test("provider mock preference proposals remain explicitly simulated and unconfirmed", async () => {
  const { project } = await feedbackProject(),
    request = (
      await call("preferences/propose", {
        project_id: project.id,
        generation_source: "provider",
      })
    ).data;
  for (let i = 0; i < 8; i++) {
    await runOneJob();
    if ((await call(`jobs/${request.job_id}`)).data.status === "succeeded")
      break;
  }
  const row = (
    await call(`preferences?project_id=${project.id}`)
  ).data.rules.find((r: { project_id: string }) => r.project_id === project.id);
  expect(row.status).toBe("proposed");
  expect(row.model_details_json.simulated).toBe(true);
  expect(row.confidence_summary).toContain("模拟");
});
