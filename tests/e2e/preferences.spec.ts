import { test, expect, type APIRequestContext } from "@playwright/test";
import { mkdir } from "node:fs/promises";
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
test("evidence → Agent proposal → explicit Web confirmation → edit → archive preserves history", async ({
  page,
  request,
}) => {
  const project = await api(request, "projects", {
      name: "偏好浏览器自动化测试",
      domain: "writing",
    }),
    created = await api(request, "sessions", {
      project_id: project.id,
      mode: "writing",
      candidate_count: 2,
    });
  await api(request, `jobs/${created.job_id}/complete`, {
    topic: {
      title: "偏好 UI 测试",
      prompt: "描写店主的具体动作",
      genre: "narrative",
      target_dimension: "具体",
      difficulty: "normal",
      constraints: [],
      generation_id: "ui-test",
    },
    candidates: ["店主关灯，摸黑找到了门锁。", "所有人都怀着对明天的希望。"],
    model_details: { agent_name: "UI fixture, not real AI" },
  });
  const session = await api(request, `sessions/${created.session.id}`);
  await api(request, "feedback", {
    session_id: session.session.id,
    task_id: session.tasks[0].id,
    candidate_ids: session.candidates.map((c: { id: string }) => c.id),
    displayed_order: session.candidate_sets[0].shuffled_order_json,
    feedback_mode: "reject_all",
    comments: [
      {
        candidate_id: session.candidates[1].id,
        text: "测试评语：希望动作具体，不要抽象总结。",
      },
    ],
  });
  await page.goto(`/preferences?project_id=${project.id}`);
  await expect(page.getByLabel("项目筛选与提议来源")).toHaveValue(project.id);
  await page.getByRole("button", { name: "从未撤销反馈生成偏好提议" }).click();
  await expect(page.locator("pre.mono")).toContainText(
    "pnpm skillforge job get",
  );
  const pending = (await api(request, "jobs")).find(
    (j: { project_id: string; job_type: string }) =>
      j.project_id === project.id && j.job_type === "preference",
  );
  await api(request, `jobs/${pending.id}/complete`, {
    proposals: [
      {
        config: {
          title: "测试规则：用具体动作表达",
          instruction:
            "写作时优先给出可观察动作，避免无依据抽象总结；保留事实。",
          family: "observable-actions",
          scope: {
            level: "project",
            project_id: project.id,
            domain: "writing",
          },
          match_spec: { kind: "guidance" },
          strength: "avoid",
          positive_examples: ["店主关灯，摸黑找到门锁。"],
          negative_examples: ["所有人都怀着希望。"],
        },
        evidence_ids: pending.payload.evidence.map((e: { id: string }) => e.id),
        counter_evidence_ids: [],
        rationale: "测试反馈支持检查抽象总结，未选出正向胜者",
        confidence_summary: "两条自动化测试反馈，不是真人偏好",
      },
    ],
    model_details: { agent_name: "UI fixture, not real AI" },
  });
  const card = page
    .getByTestId("preference-rule")
    .filter({ hasText: "测试规则：用具体动作表达" });
  await expect(card).toContainText("proposed");
  await card.getByRole("button", { name: "确认规则", exact: true }).click();
  await expect(card).toContainText("confirmed");
  await card.getByRole("button", { name: "查看证据与历史" }).click();
  await expect(card).toContainText("rule_confirm");
  await card.getByRole("button", { name: "编辑规则", exact: true }).click();
  await card
    .getByLabel("具体指导")
    .fill("测试更新：动作优先，必要事实说明保留。");
  await card.getByRole("button", { name: "保存编辑并重新确认" }).click();
  await expect(card).toContainText("proposed");
  await card.getByRole("button", { name: "确认规则", exact: true }).click();
  await expect(card).toContainText("confirmed");
  await mkdir("docs/evidence", { recursive: true });
  await page.screenshot({
    path: "docs/evidence/phase2-preference.png",
    fullPage: true,
  });
  await card.getByRole("button", { name: "停用规则", exact: true }).click();
  await expect(card).toContainText("archived");
  await page.reload();
  await expect(card).toContainText("archived");
  const row = (
    await api(request, `preferences?project_id=${project.id}`)
  ).rules.find((r: { project_id: string }) => r.project_id === project.id);
  const history = await api(request, `preferences/${row.id}/history`);
  expect(history.map((h: { version: number }) => h.version)).toEqual([
    1, 2, 3, 4, 5,
  ]);
});
test("pattern UI preserves quoted/factual exceptions and stores false positive; custom threshold persists", async ({
  page,
  request,
}) => {
  const title = "测试短语频率 " + crypto.randomUUID().slice(0, 8);
  const project = await api(request, "projects", {
    name: "模式 UI 自动化测试",
    domain: "writing",
  });
  await page.goto("/patterns");
  await page.getByLabel("检测项目（可选）").selectOption(project.id);
  await page
    .getByLabel("待检查文本")
    .fill(
      "真正的努力不是拼时间，而是找对方法。不是红色按钮，而是右边的蓝色按钮。他说：“我认，这次是我错了。”",
    );
  await page.getByRole("button", { name: "检查语言模式", exact: true }).click();
  await expect(page.getByTestId("pattern-finding")).toHaveCount(3);
  const factual = page
    .getByTestId("pattern-finding")
    .filter({ hasText: "genuine_logical_contrast" });
  await expect(factual).toContainText("豁免/保留");
  await page
    .getByTestId("pattern-finding")
    .filter({
      has: page.locator("blockquote").filter({ hasText: "不是拼时间" }),
    })
    .getByRole("button", { name: "标记误报" })
    .click();
  await expect(
    page.getByRole("status", { name: "模式保存状态" }),
  ).toContainText("不可变证据");
  await page.getByText("添加可编辑语言模式", { exact: true }).click();
  const form = page.locator("form");
  await form.getByLabel("规则标题").fill(title);
  await form.getByLabel("模式家族标识").fill("test-colloquial");
  await form
    .getByLabel("具体指导")
    .fill("在测试报道中只提示重复使用的口语短语，人物对白保留");
  await form.getByLabel("规则项目").selectOption(project.id);
  await form.getByLabel("检测方法").selectOption("phrase");
  await form.getByLabel("短语（每行一个，不支持任意正则）").fill("我不亏");
  await form.getByLabel("规则强度").selectOption("limit_frequency");
  await form.getByLabel("出现次数阈值").fill("3");
  await form.getByRole("button", { name: "保存模式", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  const stored = await api(request, "patterns");
  expect(
    stored.patterns.find(
      (p: { config_json: { title: string } }) => p.config_json.title === title,
    ).config_json.match_spec.frequency_threshold,
  ).toBe(3);
  expect(
    stored.reviews.some(
      (r: { project_id: string }) => r.project_id === project.id,
    ),
  ).toBe(true);
});
