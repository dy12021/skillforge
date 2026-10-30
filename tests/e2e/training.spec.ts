import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
async function api(
  request: import("@playwright/test").APIRequestContext,
  path: string,
  body?: unknown,
) {
  const r =
    body === undefined
      ? await request.get(`/api/${path}`)
      : await request.post(`/api/${path}`, {
          data: body,
          headers: { "Idempotency-Key": crypto.randomUUID() },
        });
  const value = await r.json();
  expect(r.ok(), JSON.stringify(value.error)).toBe(true);
  return value.data;
}
for (const count of [2, 3, 5, 8])
  test(`Agent → Web feedback → Agent read, N=${count}`, async ({
    page,
    request,
  }) => {
    if (count === 3) await page.setViewportSize({ width: 390, height: 844 });
    const project = await api(request, "projects", {
      name: `Agent E2E N=${count}`,
      domain: "writing",
    });
    const created = await api(request, "sessions", {
      project_id: project.id,
      mode: "writing",
      candidate_count: count,
    });
    await page.goto(created.url);
    await expect(
      page.getByRole("heading", { name: "等待宿主 Agent 提交" }),
    ).toBeVisible();
    const texts = [
      "他没有立刻回答。真正的成长，不是学会隐藏情绪，而是学会与自己和解。🙂",
      "凌晨一点，便利店还亮着灯。",
      "雨停以后，出租车在路口等红灯。",
      "城市很大，孤独很深。",
      "末班地铁离站后，一个人还站在广告牌旁边。",
      "收摊的人把凳子倒扣在桌上。",
      "站台上的女孩低头查下一班车。",
      "清洁工停下推车，喝了口水。",
    ];
    await api(request, `jobs/${created.job_id}/complete`, {
      topic: {
        title: "E2E Agent 测试题",
        prompt: "描写城市深夜，保持事实。",
        genre: "narrative",
        target_dimension: "可观察细节",
        difficulty: "normal",
        constraints: ["保持事实"],
        generation_id: crypto.randomUUID(),
      },
      candidates: texts.slice(0, count),
      model_details: {
        agent_name: "E2E test harness (not real AI)",
        model: null,
      },
    });
    await expect(page.getByTestId("candidate")).toHaveCount(count);
    if (count === 3)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    await expect(
      page.getByText("Agent 提交：模型来源为宿主自述，未经供应商验证"),
    ).toBeVisible();
    await page.getByLabel("反馈方式").selectOption("none");
    await page
      .getByLabel("候选 B 评语", { exact: true })
      .fill("细节更具体，保留原始证据。");
    await page
      .getByLabel(`候选 ${count > 2 ? "C" : "A"} 人工改写`, { exact: true })
      .fill("他渐渐学会直接说出自己的感受。");
    await page.getByRole("button", { name: "保存本轮反馈" }).click();
    await expect(page.getByRole("status")).toContainText("已保存到数据库");
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "已保存的原始反馈（2）" }),
    ).toBeVisible();
    const cli = spawnSync(
      process.execPath,
      [
        ".agents/skills/skillforge/scripts/skillforge.mjs",
        "session",
        "feedback",
        created.session.id,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, SKILLFORGE_URL: "http://127.0.0.1:3100" },
      },
    );
    expect(cli.status, cli.stdout + cli.stderr).toBe(0);
    const result = JSON.parse(cli.stdout);
    expect(result.data.feedback_events).toHaveLength(2);
    expect(
      result.data.feedback_events.some(
        (e: { event_type: string }) => e.event_type === "human_rewrite",
      ),
    ).toBe(true);
    if (count === 5) {
      await mkdir("docs/evidence", { recursive: true });
      await page.screenshot({
        path: "docs/evidence/phase1-agent-feedback.png",
        fullPage: true,
      });
    }
  });
test("Tiptap overlapping selection, UTF-16, diff and immutable parent", async ({
  page,
  request,
}) => {
  const project = await api(request, "projects", {
      name: "圈选 E2E",
      domain: "writing",
    }),
    s = await api(request, "sessions", {
      project_id: project.id,
      mode: "writing",
      candidate_count: 2,
    });
  const text =
    "他没有立刻回答。真正的成长，不是学会隐藏情绪，而是学会与自己和解。🙂";
  await api(request, `jobs/${s.job_id}/complete`, {
    topic: {
      title: "圈选测试",
      prompt: "分析句式",
      genre: "narrative",
      target_dimension: "表达",
      difficulty: "normal",
      constraints: [],
      generation_id: crypto.randomUUID(),
    },
    candidates: [text, "第二个版本"],
    model_details: { agent_name: "test fixture" },
  });
  await page.goto(`/sessions/${s.session.id}/annotate`);
  const snapshot = await api(request, `sessions/${s.session.id}`),
    version = snapshot.document_versions.find(
      (v: { content_text: string }) => v.content_text === text,
    );
  await page.getByLabel("选择不可变文档版本").selectOption(version.id);
  const editor = page.getByRole("textbox", { name: "圈选文档" });
  await editor.click();
  await page.keyboard.press("Control+Home");
  for (let i = 0; i < 8; i++) await page.keyboard.press("Shift+ArrowRight");
  await page.getByRole("button", { name: "保存圈选批注" }).click();
  await expect(
    page.getByRole("heading", { name: "本版本批注（1）" }),
  ).toBeVisible();
  await editor.click();
  await page.keyboard.press("Control+Home");
  for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowRight");
  await page.getByRole("button", { name: "保存圈选批注" }).click();
  await expect(
    page.getByRole("heading", { name: "本版本批注（2）" }),
  ).toBeVisible();
  // Typing on the selectable original cannot mutate its immutable version.
  await editor.click();
  await page.keyboard.type("禁止覆盖");
  await expect(editor).toHaveText(text);
  await page
    .getByLabel("人工新版本", { exact: true })
    .fill("他渐渐学会直接说出自己的感受。🙂");
  await expect(page.getByTestId("diff-preview")).toContainText("渐渐学会");
  await page.getByRole("button", { name: "保存为人工新版本" }).click();
  await expect(
    page.getByRole("status", { name: "批注与人工改写状态" }),
  ).toContainText("旧版批注需要显式重新定位");
  await page.getByLabel("选择不可变文档版本").selectOption(version.id);
  await expect(editor).toHaveText(text);
  await expect(
    page.getByRole("heading", { name: "本版本批注（2）" }),
  ).toBeVisible();
});
test("Web starts a manual Agent task; approvals and rank ties retain their semantics", async ({
  page,
  request,
}) => {
  const project = await api(request, "projects", {
    name: "Web → Agent 创建",
    domain: "dialogue",
  });
  await page.goto(`/projects/${project.id}`);
  await page.getByLabel("候选数量（2～8）").fill("3");
  await page.getByLabel("题目来源").selectOption("manual");
  const prompt = "朋友问能否把见面改到周六，直接回答周六下午有空。";
  await page.getByLabel("训练题目").fill(prompt);
  await page.getByRole("button", { name: "创建训练会话" }).click();
  await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]+\/compare$/);
  const id = page.url().split("/").at(-2)!,
    snapshot = await api(request, `sessions/${id}`),
    job = snapshot.jobs.at(-1);
  expect(job.payload.prompt).toBe(prompt);
  expect(job.status).toBe("awaiting_agent");
  await api(request, `jobs/${job.id}/complete`, {
    topic: {
      title: "手动对话题",
      prompt,
      genre: "single-turn",
      target_dimension: "直接回复",
      difficulty: "normal",
      constraints: ["周六下午有空"],
      generation_id: crypto.randomUUID(),
    },
    candidates: [
      "可以，周六下午我有空。你看三点方便吗？",
      "周六下午可以，时间你来定。",
      "改到周六没问题。我下午都在。",
    ],
    model_details: { agent_name: "E2E harness" },
  });
  await expect(page.getByTestId("candidate")).toHaveCount(3);
  await page.getByLabel("反馈方式").selectOption("approve_many");
  await page.getByLabel("认可候选 A", { exact: true }).check();
  await page.getByLabel("认可候选 C", { exact: true }).check();
  await page.getByRole("button", { name: "保存本轮反馈" }).click();
  await expect(
    page.getByRole("heading", { name: "已保存的原始反馈（1）" }),
  ).toBeVisible();
  await page.getByLabel("反馈方式").selectOption("full_ranking");
  const ranks = page.getByLabel("名次（相同数字为并列）");
  await ranks.nth(0).fill("1");
  await ranks.nth(1).fill("1");
  await ranks.nth(2).fill("2");
  await page.getByRole("button", { name: "保存本轮反馈" }).click();
  await expect(
    page.getByRole("heading", { name: "已保存的原始反馈（2）" }),
  ).toBeVisible();
  const saved = await api(request, `sessions/${id}`);
  expect(saved.feedback_events[0].payload_json.ranking_groups).toBeNull();
  expect(
    saved.feedback_events[1].payload_json.ranking_groups.map(
      (group: string[]) => group.length,
    ),
  ).toEqual([2, 1]);
});
test("Web mock provider is visibly simulated and executes a real queued database job", async ({
  page,
  request,
}) => {
  const project = await api(request, "projects", {
    name: "Web mock provider",
    domain: "writing",
  });
  await page.goto(`/projects/${project.id}`);
  await page.getByLabel("生成来源").selectOption("provider");
  await page.getByRole("button", { name: "创建训练会话" }).click();
  await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]+\/compare$/);
  const runWorker = () => {
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
  };
  runWorker();
  await expect(
    page.getByText("演示模式：固定模拟候选，不是真实 AI 生成"),
  ).toBeVisible();
  await expect(page.getByTestId("candidate")).toHaveCount(3);
  const id = page.url().split("/").at(-2)!;
  const first = await api(request, `sessions/${id}`);
  await page.getByRole("button", { name: "继续探索下一轮" }).click();
  await expect(
    page.getByRole("heading", { name: "provider 生成任务进行中" }),
  ).toBeVisible();
  runWorker();
  await expect
    .poll(
      async () => (await api(request, `sessions/${id}`)).candidate_sets.length,
    )
    .toBe(2);
  await page.reload();
  await expect(page.getByTestId("candidate")).toHaveCount(3);
  const second = await api(request, `sessions/${id}`);
  expect(second.tasks[1].prompt).not.toBe(first.tasks[0].prompt);
  await page.getByLabel("认可候选 A", { exact: true }).check();
  await page.getByRole("button", { name: "保存本轮反馈" }).click();
  await expect(page.getByRole("status")).toContainText("已保存到数据库");
  const selected = await api(request, `sessions/${id}`);
  const winner = selected.candidates.find(
    (c: { id: string }) =>
      c.id === selected.candidate_sets.at(-1).shuffled_order_json[0],
  );
  await page.getByRole("button", { name: "挑战当前最佳" }).click();
  await expect(
    page.getByRole("heading", { name: "provider 生成任务进行中" }),
  ).toBeVisible();
  runWorker();
  await expect
    .poll(
      async () => (await api(request, `sessions/${id}`)).candidate_sets.length,
    )
    .toBe(3);
  const challenged = await api(request, `sessions/${id}`);
  expect(challenged.tasks.at(-1).prompt).toBe(second.tasks.at(-1).prompt);
  expect(
    challenged.candidates
      .filter(
        (c: { set_id: string }) =>
          c.set_id === challenged.candidate_sets.at(-1).id,
      )
      .some((c: { text: string }) => c.text === winner.text),
  ).toBe(true);
  await page.reload();
  await page
    .getByLabel("查看历史轮次")
    .selectOption(first.candidate_sets[0].id);
  await expect(page.getByTestId("candidate")).toHaveCount(3);
});
test("standalone trainer CLI creates and submits a job through actual HTTP", async ({
  request,
}) => {
  const project = await api(request, "projects", {
      name: "CLI smoke",
      domain: "dialogue",
    }),
    env = { ...process.env, SKILLFORGE_URL: "http://127.0.0.1:3100" };
  const run = (args: string[]) => {
    const r = spawnSync(
      process.execPath,
      [".agents/skills/skillforge/scripts/skillforge.mjs", ...args],
      { encoding: "utf8", env },
    );
    expect(r.status, r.stdout + r.stderr).toBe(0);
    return JSON.parse(r.stdout);
  };
  const created = run([
    "session",
    "create",
    "--project",
    project.id,
    "--mode",
    "dialogue",
    "--topic",
    "auto",
    "--candidates",
    "2",
  ]);
  const dir = resolve("test-results/cli");
  await mkdir(dir, { recursive: true });
  const file = resolve(dir, "output.json");
  await writeFile(
    file,
    JSON.stringify({
      topic: {
        title: "改期",
        prompt: "朋友询问能否改到周六，回复下午有空。",
        genre: "single-turn",
        target_dimension: "直接回复",
        difficulty: "normal",
        constraints: [],
        generation_id: crypto.randomUUID(),
      },
      candidates: [
        "周六下午我有空，三点方便吗？",
        "可以改到周六，我下午有时间。",
      ],
      model_details: { agent_name: "CLI smoke harness" },
    }),
  );
  run(["job", "submit", created.data.job_id, "--file", file]);
  const result = run(["session", "get", created.data.session.id]);
  expect(result.data.candidates).toHaveLength(2);
  expect(created.url).toContain("/compare");
});
