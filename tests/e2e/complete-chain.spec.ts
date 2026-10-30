import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

test("one project: Agent CLI → Web feedback → evidence-based proposal → confirmed build → offline install → blind evaluation", async ({
  page,
  request,
}) => {
  test.setTimeout(60000);
  const nonce = crypto.randomUUID().slice(0, 8),
    directory = resolve(".local/e2e-complete-chain", nonce);
  await mkdir(directory, { recursive: true });
  async function api(path: string, body?: unknown, method = "POST") {
    const response =
      body === undefined
        ? await request.get(`/api/${path}`)
        : await request.fetch(`/api/${path}`, {
            method,
            data: body,
            headers: { "Idempotency-Key": crypto.randomUUID() },
          });
    const value = await response.json();
    expect(response.ok(), JSON.stringify(value.error)).toBe(true);
    return value.data;
  }
  const run = (args: string[]) => {
    const processResult = spawnSync(
      process.execPath,
      [".agents/skills/skillforge/scripts/skillforge.mjs", ...args],
      {
        encoding: "utf8",
        env: { ...process.env, SKILLFORGE_URL: "http://127.0.0.1:3100" },
      },
    );
    expect(
      processResult.status,
      processResult.stdout + processResult.stderr,
    ).toBe(0);
    return JSON.parse(processResult.stdout);
  };
  async function submit(job: string, name: string, output: unknown) {
    const file = resolve(directory, name + ".json");
    await writeFile(file, JSON.stringify(output));
    run(["job", "submit", job, "--file", file]);
  }
  const project = await api("projects", {
    name: "完整链路 E2E fixture " + nonce,
    domain: "writing",
  });
  const created = run([
    "session",
    "create",
    "--project",
    project.id,
    "--mode",
    "writing",
    "--topic",
    "auto",
    "--candidates",
    "3",
  ]).data;
  await page.goto(created.url);
  await expect(
    page.getByRole("heading", { name: "等待宿主 Agent 提交" }),
  ).toBeVisible();
  const requestJob = run(["job", "get", created.job_id]).data;
  expect(requestJob.status).toBe("awaiting_agent");
  await submit(created.job_id, "training", {
    topic: {
      title: "测试：夜间车站",
      prompt: "描写深夜车站可观察的动作。",
      genre: "narrative",
      target_dimension: "具体细节",
      difficulty: "normal",
      constraints: ["保留深夜车站"],
      generation_id: crypto.randomUUID(),
    },
    candidates: [
      "测试甲：司机把零钱盒放回车上。",
      "测试乙：站牌旁的人收起雨伞。",
      "测试丙：每个人都追逐无限可能。",
    ],
    model_details: { agent_name: "完整链路自动化 fixture，不是真实 AI" },
  });
  await expect(page.getByTestId("candidate")).toHaveCount(3);
  await page.getByLabel("反馈方式").selectOption("none");
  await page
    .getByLabel("候选 B 评语", { exact: true })
    .fill("自动化测试评语：动作具体。 ");
  await page
    .getByLabel("候选 C 人工改写", { exact: true })
    .fill("自动化测试改写：站牌下的人收起雨伞。");
  await page.getByRole("button", { name: "保存本轮反馈" }).click();
  await expect(page.getByRole("status")).toContainText("已保存到数据库");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "已保存的原始反馈（2）" }),
  ).toBeVisible();
  const feedback = run(["session", "feedback", created.session.id]).data;
  expect(feedback.feedback_events).toHaveLength(2);
  const next = run(["session", "next", created.session.id]).data;
  const nextJob = run(["job", "get", next.job_id]).data;
  expect(nextJob.payload.feedback_context.events).toHaveLength(2);
  expect(JSON.stringify(nextJob.payload.feedback_context)).toContain(
    "自动化测试评语：动作具体",
  );
  await submit(next.job_id, "next-training", {
    topic: {
      title: "测试：清晨车站",
      prompt: "描写清晨车站可观察的动作。",
      genre: "narrative",
      target_dimension: "具体细节",
      difficulty: "normal",
      constraints: ["保留清晨车站"],
      generation_id: crypto.randomUUID(),
    },
    candidates: [
      "测试下一轮甲：清洁工推着车走过站台。",
      "测试下一轮乙：司机打开车门。",
      "测试下一轮丙：乘客在站牌下整理衣领。",
    ],
    model_details: { agent_name: "完整链路自动化 fixture，不是真实 AI" },
  });
  await expect
    .poll(
      async () =>
        (await api(`sessions/${created.session.id}`)).candidate_sets.length,
    )
    .toBe(2);

  await page.goto(`/preferences?project_id=${project.id}`);
  await expect(page.getByLabel("项目筛选与提议来源")).toHaveValue(project.id);
  await page.getByRole("button", { name: "从未撤销反馈生成偏好提议" }).click();
  await expect(page.locator("pre.mono")).toContainText(
    "pnpm skillforge job get",
  );
  const pending = (await api("jobs")).find(
    (j: { project_id: string; job_type: string }) =>
      j.project_id === project.id && j.job_type === "preference",
  );
  const preferenceJob = run(["job", "get", pending.id]).data;
  expect(preferenceJob.payload.evidence).toHaveLength(2);
  await submit(pending.id, "preference", {
    proposals: [
      {
        config: {
          title: "完整链路测试：具体动作",
          instruction: "写作时优先描述可观察动作并保留事实",
          family: "full-chain-" + nonce,
          scope: {
            level: "project",
            project_id: project.id,
            domain: "writing",
          },
          match_spec: { kind: "guidance" },
          strength: "suggest_only",
        },
        evidence_ids: preferenceJob.payload.evidence.map(
          (e: { id: string }) => e.id,
        ),
        counter_evidence_ids: [],
        rationale: "仅根据两条自动化测试反馈提出",
        confidence_summary: "测试 fixture，不是真人偏好",
      },
    ],
    model_details: { agent_name: "完整链路自动化 fixture，不是真实 AI" },
  });
  const rule = page
    .getByTestId("preference-rule")
    .filter({ hasText: "完整链路测试：具体动作" });
  await expect(rule).toContainText("proposed");
  await rule.getByRole("button", { name: "确认规则", exact: true }).click();
  await expect(rule).toContainText("confirmed");

  await page.goto("/skills");
  await page.getByLabel("构建项目").selectOption(project.id);
  await page.getByLabel("Skill 类型").selectOption("personalized-writing");
  const buildResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/skills/builds") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "编译确认规则并验证 ZIP" }).click();
  const build = (await (await buildResponse).json()).data.build;
  expect(JSON.stringify(build.rules_snapshot)).toContain(
    "完整链路测试：具体动作",
  );
  await page.goto(`/skills/${build.id}`);
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("link", { name: "下载此不可变版本 ZIP" }).click();
  const zip = resolve(directory, "writing.zip");
  await (await downloadEvent).saveAs(zip);
  run(["skill", "validate", zip]);
  run([
    "skill",
    "install",
    zip,
    "--target",
    resolve(directory, ".agents/skills"),
  ]);

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "最近构建的 Skill" }),
  ).toBeVisible();
  await expect(page.locator(`a[href="/skills/${build.id}"]`)).toBeVisible();

  await page.goto("/evaluations");
  await page.getByLabel("项目筛选", { exact: true }).selectOption(project.id);
  await page.getByLabel("固定被测 Skill 版本").selectOption(build.id);
  await page
    .getByLabel("这是演示/自动化测试评测，所有票永久标记为测试票")
    .check();
  await page.getByRole("button", { name: "创建固定版本盲测" }).click();
  await expect(page).toHaveURL(/\/evaluations\/[0-9a-f-]+$/);
  const evaluation = page.url().split("/").at(-1)!,
    detail = await api(`evaluations/${evaluation}`),
    evalJob = run(["job", "get", detail.job.id]).data;
  expect(evalJob.payload.build_hash).toBe(build.content_hash);
  await submit(detail.job.id, "evaluation", {
    pairs: evalJob.payload.holdouts.map(
      (t: { task_id: string; prompt: string }, i: number) => ({
        task_id: t.task_id,
        baseline: `自动化对照文本 ${i}：${t.prompt}`,
        personalized: `自动化规则文本 ${i}：${t.prompt}`,
      }),
    ),
    model_details: { agent_name: "完整链路自动化 fixture，不是真实 AI" },
  });
  await expect(page.getByTestId("evaluation-left")).toBeVisible();
  expect((await api(`evaluations/${evaluation}/results`)).mapping).toBeNull();
  for (let i = 0; i < 5; i++) {
    await page.getByRole("radio", { name: "两者平手", exact: true }).check();
    await page.getByRole("button", { name: "保存本题投票" }).click();
    await expect
      .poll(async () => (await api(`evaluations/${evaluation}`)).voted_count)
      .toBe(i + 1);
  }
  const results = run(["evaluation", "results", evaluation]).data;
  expect(results.mapping).toHaveLength(5);
  expect(results.test_sample_count).toBe(5);
  expect(results.human_sample_count).toBe(0);
  expect(results.metrics).toBeNull();
  await expect(page.getByTestId("evaluation-results")).toContainText("待评测");
});

test("a user can create a corpus-derived task without silently transferring the source text", async ({
  page,
  request,
}) => {
  async function api(path: string, body?: unknown) {
    const response =
      body === undefined
        ? await request.get(`/api/${path}`)
        : await request.post(`/api/${path}`, {
            data: body,
            headers: { "Idempotency-Key": crypto.randomUUID() },
          });
    const value = await response.json();
    expect(response.ok(), JSON.stringify(value.error)).toBe(true);
    return value.data;
  }
  const project = await api("projects", {
    name: "语料出题 E2E fixture " + crypto.randomUUID().slice(0, 8),
    domain: "writing",
  });
  const source = "自动化测试原文：店主关门时先关了灯。" + crypto.randomUUID();
  const asset = (
    await api("corpora", {
      project_id: project.id,
      filename: "training-source.txt",
      mime: "text/plain",
      content: source,
      source_name: "自编测试数据",
      license_confirmed: true,
      purpose: "observational",
    })
  ).asset;
  const segment = (await api(`corpora/${asset.id}`)).segments[0];
  await page.goto(`/projects/${project.id}`);
  await page.getByLabel("题目来源").selectOption("corpus-derived");
  await expect(page.getByLabel("参考语料").locator("option")).toContainText([
    "选择本项目语料",
    "training-source.txt",
  ]);
  await page.getByLabel("参考语料").selectOption(asset.id);
  await expect(page.getByLabel("参考片段").locator("option")).toHaveCount(2);
  await page.getByLabel("参考片段").selectOption(segment.id);
  await expect(page.locator("blockquote")).toContainText(source);
  const prompt = "写一个夜里关店的动作，不引用原文。";
  await page.getByLabel("训练题目").fill(prompt);
  await page.getByLabel("我确认将自己填写的训练题交给所选模型").check();
  await page.getByRole("button", { name: "创建训练会话" }).click();
  await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]+\/compare$/);
  const id = page.url().split("/").at(-2)!,
    state = await api(`sessions/${id}`),
    job = state.jobs.at(-1);
  expect(job.payload.source).toBe("corpus-derived");
  expect(job.payload.corpus_segment_id).toBe(segment.id);
  expect(JSON.stringify(job.payload)).not.toContain(source);
  await api(`jobs/${job.id}/complete`, {
    topic: {
      title: "自动化语料衍生题",
      prompt,
      genre: "narrative",
      target_dimension: "动作",
      difficulty: "normal",
      constraints: [],
      generation_id: crypto.randomUUID(),
    },
    candidates: [
      "她关灯后拉下卷帘。",
      "他把门锁好，转身离开。",
      "店门关上，巷子暗了。",
    ],
    model_details: { agent_name: "E2E fixture，不是真实 AI" },
  });
  await expect(page.getByTestId("candidate")).toHaveCount(3);
  await page.reload();
  expect((await api(`sessions/${id}`)).tasks[0].source).toBe("corpus-derived");
  await expect(page.getByText(prompt, { exact: true })).toBeVisible();
});
