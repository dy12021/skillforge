import { test, expect, type APIRequestContext } from "@playwright/test";
async function api(request: APIRequestContext, path: string, body?: unknown) {
  const response =
    body === undefined
      ? await request.get(`/api/${path}`)
      : await request.post(`/api/${path}`, {
          data: body,
          headers: { "Idempotency-Key": crypto.randomUUID() },
        });
  const result = await response.json();
  expect(response.ok(), JSON.stringify(result.error)).toBe(true);
  return result.data;
}
const details = { agent_name: "automated UI test fixture, not real AI" };
const topic = {
  title: "修订浏览器测试",
  prompt: "保留30元费用与原始引语。",
  genre: "narrative",
  target_dimension: "自然",
  difficulty: "normal",
  constraints: ["保留事实"],
  generation_id: "browser-test",
};
test("Web revision proposal requires review, preserves original and persists rejection", async ({
  page,
  request,
}) => {
  const project = await api(request, "projects", {
    name: "修订 UI 自动化测试",
    domain: "writing",
  });
  const session = await api(request, "sessions", {
    project_id: project.id,
    mode: "writing",
    candidate_count: 2,
  });
  const original = "费用30元。他没有迟到，说：“周六见”。";
  await api(request, `jobs/${session.job_id}/complete`, {
    topic,
    candidates: [original, "另一个候选。"],
    model_details: details,
  });
  const initial = await api(request, `sessions/${session.session.id}`);
  const parent = initial.document_versions.find(
    (v: { content_text: string }) => v.content_text === original,
  );
  await page.goto(`/sessions/${session.session.id}/annotate`);
  await page.getByLabel("选择不可变文档版本").selectOption(parent.id);
  await page.getByRole("button", { name: "创建 AI 修订任务" }).click();
  await expect(page.getByTestId("revision-suggestion")).toHaveCount(1);
  let snapshot = await api(request, `sessions/${session.session.id}`);
  let revision = snapshot.revisions[0];
  await api(request, `jobs/${revision.job_id}/complete`, {
    replacement: "费用30元。他没有迟到，说：“周六见”。门外的雨停了。",
    rationale: "测试建议；保留事实",
    model_details: details,
  });
  await expect(page.getByTestId("ai-revision-diff")).toContainText(
    "门外的雨停了",
  );
  await page.getByRole("button", { name: "接受建议", exact: true }).click();
  await expect(page.getByRole("alert", { name: "修订错误" })).toContainText(
    "复核",
  );
  await page.getByLabel("我已复核事实、数字、引语、否定及人物语气").check();
  await page.getByRole("button", { name: "接受建议", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "圈选文档" })).toContainText(
    "门外的雨停了",
  );
  await page.getByLabel("选择不可变文档版本").selectOption(parent.id);
  await expect(page.getByRole("textbox", { name: "圈选文档" })).toHaveText(
    original,
  );
  await page.getByRole("button", { name: "创建 AI 修订任务" }).click();
  await expect(page.getByTestId("revision-suggestion")).toHaveCount(2);
  snapshot = await api(request, `sessions/${session.session.id}`);
  revision = snapshot.revisions.find(
    (r: { status: string }) => r.status === "awaiting_generation",
  );
  await api(request, `jobs/${revision.job_id}/complete`, {
    replacement: "费用30元。他没有迟到，说：“周六见”。",
    rationale: "拒绝流程测试",
    model_details: details,
  });
  await page.getByRole("button", { name: "拒绝建议", exact: true }).click();
  await page.reload();
  snapshot = await api(request, `sessions/${session.session.id}`);
  expect(snapshot.revisions.map((r: { status: string }) => r.status)).toEqual([
    "accepted",
    "rejected",
  ]);
  expect(snapshot.document_versions).toHaveLength(3);
});
test("Web generates independent topic, challenges winner and switches round history", async ({
  page,
  request,
}) => {
  const project = await api(request, "projects", {
    name: "主题与挑战 UI 测试",
    domain: "writing",
  });
  await page.goto("/topics");
  await page.getByLabel("项目", { exact: true }).selectOption(project.id);
  await page.getByRole("button", { name: "生成独立训练题" }).click();
  await expect(page.locator("pre.mono")).toContainText(
    "pnpm skillforge job get",
  );
  const jobs = await api(request, "jobs");
  const job = jobs.find(
    (j: { project_id: string; job_type: string }) =>
      j.project_id === project.id && j.job_type === "topic",
  );
  await api(request, `jobs/${job.id}/complete`, {
    topic,
    model_details: details,
  });
  await page.getByRole("button", { name: "用此题开始比较" }).click();
  await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]+\/compare$/);
  const id = page.url().split("/").at(-2)!;
  let snapshot = await api(request, `sessions/${id}`);
  await api(request, `jobs/${snapshot.jobs[0].id}/complete`, {
    topic,
    candidates: ["测试原优胜者。", "测试另一版本。", "测试第三版。"],
    model_details: details,
  });
  await expect(page.getByTestId("candidate")).toHaveCount(3);
  await page.getByLabel("认可候选 A", { exact: true }).check();
  await page.getByRole("button", { name: "保存本轮反馈" }).click();
  await expect(page.getByRole("status")).toContainText("已保存到数据库");
  await page.getByRole("button", { name: "挑战当前最佳" }).click();
  await expect
    .poll(async () => (await api(request, `sessions/${id}`)).jobs.length)
    .toBe(2);
  snapshot = await api(request, `sessions/${id}`);
  const challenge = snapshot.jobs.at(-1),
    champion = challenge.payload.champion.text;
  await api(request, `jobs/${challenge.id}/complete`, {
    topic,
    candidates: [champion, "新挑战者一。", "新挑战者二。"],
    model_details: details,
  });
  await expect(page.getByTestId("candidate")).toHaveCount(3);
  await page.getByLabel("历史轮次").selectOption(snapshot.candidate_sets[0].id);
  await expect(page.getByTestId("candidate")).toHaveCount(3);
  await expect(
    page.getByTestId("candidate").filter({ hasText: "新挑战者一" }),
  ).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel("历史轮次").locator("option")).toHaveCount(2);
});
