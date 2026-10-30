import { beforeAll, afterAll, describe, expect, test } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool, OWNER_ID, WORKSPACE_ID } from "../packages/core/src/db";
import { workspaces } from "../packages/core/src/schema";
import { GET, POST, PATCH, DELETE } from "../apps/web/app/api/[...path]/route";
beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./migrations" });
  await db
    .insert(workspaces)
    .values({ id: WORKSPACE_ID, owner_id: OWNER_ID, name: "Test workspace" })
    .onConflictDoNothing();
});
afterAll(async () => {
  await pool.end();
});
async function call(
  method: string,
  path: string,
  body?: unknown,
  key = crypto.randomUUID(),
) {
  const handler = { GET, POST, PATCH, DELETE }[method as "GET"];
  const response = await handler(
    new Request("http://localhost/api/" + path, {
      method,
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  );
  return { status: response.status, ...(await response.json()) };
}
describe("PostgreSQL-backed projects API", () => {
  test("CRUD, concurrency-safe idempotency, optimistic lock, persisted reload", async () => {
    const key = crypto.randomUUID(),
      input = { name: "持久化项目", domain: "writing" };
    const [a, b] = await Promise.all([
      call("POST", "projects", input, key),
      call("POST", "projects", input, key),
    ]);
    expect(a.status).toBe(200);
    expect(a.data.id).toBe(b.data.id);
    expect(a.request_id).not.toBe(b.request_id);
    expect(
      (await call("POST", "projects", { ...input, name: "不同输入" }, key))
        .status,
    ).toBe(409);
    const id = a.data.id;
    expect((await call("GET", `projects/${id}`)).data.name).toBe(input.name);
    const patched = await call("PATCH", `projects/${id}`, {
      name: "更新项目",
      expected_version: 1,
    });
    expect(patched.data.version).toBe(2);
    expect(
      (
        await call("PATCH", `projects/${id}`, {
          name: "过期更新",
          expected_version: 1,
        })
      ).status,
    ).toBe(409);
    expect(
      (await call("GET", "projects")).data.some(
        (p: { id: string }) => p.id === id,
      ),
    ).toBe(true);
    expect(
      (await call("DELETE", `projects/${id}`, { expected_version: 2 })).status,
    ).toBe(200);
    expect((await call("GET", `projects/${id}`)).status).toBe(404);
  });
  test("invalid enum and missing idempotency key are explicit 400s", async () => {
    expect(
      (await call("POST", "projects", { name: "x", domain: "bogus" })).status,
    ).toBe(400);
    const r = await POST(
      new Request("http://localhost/api/projects", {
        method: "POST",
        body: JSON.stringify({ name: "x", domain: "writing" }),
      }),
    );
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe("IDEMPOTENCY_REQUIRED");
  });
  test("blocks cross-site mutation and does not expose configuration secrets", async () => {
    const r = await POST(
      new Request("http://localhost/api/projects", {
        method: "POST",
        headers: { origin: "https://untrusted.example" },
        body: "{}",
      }),
    );
    expect(r.status).toBe(403);
    const settings = await call("GET", "settings");
    expect(settings.data.mock).toBe(true);
    expect(JSON.stringify(settings)).not.toMatch(
      /MODEL_API_KEY|skillforge_local/,
    );
  });
  test("accepts the browser loopback Host when Next canonicalizes its internal URL", async () => {
    const r = await POST(
      new Request("http://localhost:3100/api/projects", {
        method: "POST",
        headers: {
          host: "127.0.0.1:3100",
          origin: "http://127.0.0.1:3100",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          name: "same-origin regression",
          domain: "writing",
        }),
      }),
    );
    expect(r.status).toBe(200);
    const remote = await GET(
      new Request("http://localhost:3100/api/settings", {
        headers: { host: "untrusted.example" },
      }),
    );
    expect(remote.status).toBe(403);
  });
});
