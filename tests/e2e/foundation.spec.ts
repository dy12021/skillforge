import { test, expect } from "@playwright/test";
test("create and edit a project, reload from PostgreSQL, explicit mock label", async ({
  page,
}) => {
  await page.goto("/projects");
  const name = "E2E-" + Date.now();
  await page.getByLabel("项目名称").fill(name);
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await page.getByRole("link", { name: new RegExp(name) }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("项目名称")).toHaveValue(name);
  await page.getByLabel("项目名称").fill(name + "-更新");
  await page.getByRole("button", { name: "保存设置" }).click();
  await expect(page.getByRole("status")).toHaveText("已保存到数据库");
  await page.goto("/settings");
  await expect(
    page.getByText("演示模式：固定模拟样例，不是真实 AI 能力"),
  ).toBeVisible();
});
