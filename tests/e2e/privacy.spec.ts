import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("explicit session privacy erase exports first, clears original records and leaves an honest tombstone", async ({
  page,
  request,
}) => {
  async function post(path: string, body: unknown) {
    const response = await request.post(`/api/${path}`, {
      data: body,
      headers: { "Idempotency-Key": crypto.randomUUID() },
    });
    const value = await response.json();
    expect(response.ok(), JSON.stringify(value.error)).toBe(true);
    return value.data;
  }
  const project = await post("projects", {
    name: "隐私清除 E2E fixture " + crypto.randomUUID().slice(0, 8),
    domain: "writing",
  });
  const session = await post("sessions", {
    project_id: project.id,
    mode: "writing",
    candidate_count: 2,
  });
  const privateText = "此句只供自动化清除测试，不代表真实用户材料。";
  await post(`jobs/${session.job_id}/complete`, {
    topic: {
      title: "隐私测试题",
      prompt: "一次性的隐私测试题",
      genre: "narrative",
      target_dimension: "细节",
      difficulty: "normal",
      constraints: [],
      generation_id: crypto.randomUUID(),
    },
    candidates: [privateText, "另一个测试版本。"],
    model_details: { agent_name: "privacy E2E fixture" },
  });
  await page.goto(`/sessions/${session.session.id}/privacy`);
  const erase = page.getByRole("button", { name: "永久清除此会话数据" });
  await expect(erase).toBeDisabled();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "下载本会话原始数据" }).click();
  const download = await downloadPromise;
  expect(await download.failure()).toBeNull();
  const path = await download.path();
  expect(await readFile(path!, "utf8")).toContain(privateText);
  await page
    .getByLabel("我确认永久清除本会话原始反馈、文档和关联证据文本")
    .check();
  await erase.click();
  await expect(
    page.getByRole("heading", { name: "隐私清除已完成" }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText("历史");
  expect(
    (await request.get(`/api/sessions/${session.session.id}`)).status(),
  ).toBe(404);
  const backup = await (await request.get("/api/export")).json();
  expect(JSON.stringify(backup)).not.toContain(privateText);
  expect(
    backup.privacy_erasures.some(
      (r: { target_id: string }) => r.target_id === session.session.id,
    ),
  ).toBe(true);
});
