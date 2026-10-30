import { afterEach, test, expect, vi } from "vitest";
import { api } from "../apps/web/lib/api";
afterEach(() => vi.unstubAllGlobals());
test("lost mutation responses reuse the same idempotency key; successful repeated intents get new keys", async () => {
  const path = "test-network-" + crypto.randomUUID(),
    keys: string[] = [],
    fetcher = vi
      .fn()
      .mockImplementationOnce(async (_url, init) => {
        keys.push(init.headers["Idempotency-Key"]);
        throw new TypeError("connection lost after server commit");
      })
      .mockImplementation(async (_url, init) => {
        keys.push(init.headers["Idempotency-Key"]);
        return Response.json({
          data: { saved: true },
          error: null,
          request_id: crypto.randomUUID(),
        });
      });
  vi.stubGlobal("fetch", fetcher);
  await expect(
    api(path, "POST", { private_text: "只留在当前表单，不写入本地持久存储" }),
  ).rejects.toThrow("connection lost");
  expect(
    await api(path, "POST", {
      private_text: "只留在当前表单，不写入本地持久存储",
    }),
  ).toEqual({ saved: true });
  await api(path, "POST", {
    private_text: "只留在当前表单，不写入本地持久存储",
  });
  expect(keys[1]).toBe(keys[0]);
  expect(keys[2]).not.toBe(keys[1]);
});
test("server failures keep an operation key, while edited inputs and explicit keys remain distinct", async () => {
  const path = "test-error-" + crypto.randomUUID(),
    keys: string[] = [],
    fetcher = vi
      .fn()
      .mockImplementationOnce(async (_url, init) => {
        keys.push(init.headers["Idempotency-Key"]);
        return Response.json(
          {
            data: null,
            error: { code: "DB_UNAVAILABLE", message: "retry" },
            request_id: "request-1",
          },
          { status: 503 },
        );
      })
      .mockImplementation(async (_url, init) => {
        keys.push(init.headers["Idempotency-Key"]);
        return Response.json({
          data: "ok",
          error: null,
          request_id: "request-2",
        });
      });
  vi.stubGlobal("fetch", fetcher);
  await expect(api(path, "POST", { value: 1 })).rejects.toThrow("retry");
  await api(path, "POST", { value: 1 });
  await api(path, "POST", { value: 2 });
  await api(path, "POST", { value: 3 }, "explicit-operation-key");
  expect(keys[1]).toBe(keys[0]);
  expect(keys[2]).not.toBe(keys[1]);
  expect(keys[3]).toBe("explicit-operation-key");
});
