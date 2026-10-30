import { test, expect, type APIRequestContext } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
async function api(
  request: APIRequestContext,
  path: string,
  body?: unknown,
  method = "POST",
) {
  const r =
    body === undefined
      ? await request.get(`/api/${path}`)
      : await request.fetch(`/api/${path}`, {
          method,
          data: body,
          headers: { "Idempotency-Key": crypto.randomUUID() },
        });
  const result = await r.json();
  expect(r.ok(), JSON.stringify(result.error)).toBe(true);
  return result.data;
}
async function setup(request: APIRequestContext) {
  const p = await api(request, "projects", {
      name: "五题盲测 E2E fixture " + crypto.randomUUID().slice(0, 8),
      domain: "writing",
    }),
    r = await api(request, "preferences", {
      config: {
        title: "测试规则：动作与事实",
        instruction: "描述可见动作，保留给定事实",
        family: "evaluation-ui",
        scope: { level: "project", project_id: p.id, domain: "writing" },
        match_spec: { kind: "guidance" },
      },
    });
  await api(
    request,
    `preferences/${r.id}`,
    { action: "confirm", expected_version: 1 },
    "PATCH",
  );
  const build = (
    await api(request, "skills/builds", {
      project_id: p.id,
      type: "personalized-writing",
    })
  ).build;
  return { project: p, build };
}
test("five blind judgments persist without source leaks; test votes reveal maps but never claim human improvement", async ({
  page,
  request,
}) => {
  const { project, build } = await setup(request);
  await page.goto("/evaluations");
  await page.getByLabel("项目筛选", { exact: true }).selectOption(project.id);
  await page.getByLabel("固定被测 Skill 版本").selectOption(build.id);
  await page
    .getByLabel("这是演示/自动化测试评测，所有票永久标记为测试票")
    .check();
  await page.getByRole("button", { name: "创建固定版本盲测" }).click();
  await expect(page).toHaveURL(/\/evaluations\/[0-9a-f-]+$/);
  const id = page.url().split("/").at(-1)!;
  await expect(
    page.getByRole("heading", { name: "等待宿主 Agent 生成同题双版本" }),
  ).toBeVisible();
  const initial = await api(request, `evaluations/${id}`),
    job = await api(request, `jobs/${initial.job.id}`);
  expect(job.payload.build_hash).toBe(build.content_hash);
  await api(request, `jobs/${job.id}/complete`, {
    pairs: job.payload.holdouts.map(
      (t: { task_id: string; prompt: string }, i: number) => ({
        task_id: t.task_id,
        baseline: `自动化测试文本${i}甲：${t.prompt}`,
        personalized: `自动化测试文本${i}乙：${t.prompt}`,
      }),
    ),
    model_details: { agent_name: "E2E fixture, not real AI" },
  });
  await expect(page.getByTestId("evaluation-left")).toBeVisible();
  const left = await page.getByTestId("evaluation-left").innerText();
  await page.reload();
  await expect(page.getByTestId("evaluation-left")).toHaveText(left);
  const blinded = await api(request, `evaluations/${id}`);
  expect(JSON.stringify(blinded)).not.toContain("left_source");
  expect((await api(request, `evaluations/${id}/results`)).mapping).toBeNull();
  const labels = [
    "更偏好左侧",
    "更偏好右侧",
    "两者平手",
    "两者都不满意",
    "更偏好左侧",
  ];
  for (let i = 0; i < 5; i++) {
    await page.getByRole("radio", { name: labels[i], exact: true }).check();
    await page
      .getByLabel("本题评语（可选）")
      .fill(`自动化测试投票 ${i + 1}，不代表个人偏好`);
    await page.getByRole("button", { name: "保存本题投票" }).click();
    await expect
      .poll(async () => (await api(request, `evaluations/${id}`)).voted_count)
      .toBe(i + 1);
    if (i < 4)
      await expect(
        page.getByRole("radio", { name: labels[i + 1], exact: true }),
      ).toBeVisible();
  }
  await expect(page.getByTestId("evaluation-results")).toContainText(
    "可用真人样本：0",
  );
  await expect(page.getByTestId("evaluation-results")).toContainText("待评测");
  await expect(page.getByTestId("evaluation-results")).toContainText(
    /测试票：\s*5/u,
  );
  await page.getByText("投票完成后的来源与模型配置", { exact: true }).click();
  await expect(page.getByTestId("evaluation-results")).toContainText(
    "left_source",
  );
  const results = await api(request, `evaluations/${id}/results`);
  expect(results.metrics).toBeNull();
  expect(results.test_metrics.sample_count).toBe(5);
  expect(results.mapping).toHaveLength(5);
  expect((await api(request, `skills/builds/${build.id}`)).content_hash).toBe(
    build.content_hash,
  );
  await mkdir("docs/evidence", { recursive: true });
  await page.screenshot({
    path: "docs/evidence/phase4-blind-test.png",
    fullPage: true,
  });
  await page.reload();
  await expect(page.getByTestId("evaluation-results")).toContainText(
    /测试票：\s*5/u,
  );
});
test("visible mock evaluation is generated through a real queued worker, with no quality result before voting", async ({
  page,
  request,
}) => {
  const { build } = await setup(request),
    created = await api(request, "evaluations", {
      build_id: build.id,
      generation_source: "provider",
      test_run: true,
    });
  await page.goto(created.url);
  const worker = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/worker.ts", "--once"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL:
          process.env.TEST_DATABASE_URL ??
          "postgresql://skillforge:skillforge_test@localhost:55433/skillforge_test",
        MODEL_PROVIDER: "mock",
        MOCK_MODE: "true",
      },
    },
  );
  expect(worker.status, worker.stdout + worker.stderr).toBe(0);
  await expect(
    page.getByText(
      "模拟评测：固定样例只验证管线，不代表真实 AI 能力或风格改善。",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByTestId("evaluation-left")).toBeVisible();
  await expect(page.getByTestId("evaluation-results")).toContainText("待评测");
  expect(
    (await api(request, `evaluations/${created.run.id}/results`)).metrics,
  ).toBeNull();
});
