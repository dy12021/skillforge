export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public requestId: string,
  ) {
    super(message);
  }
}
const pendingOperations = new Map<string, { key: string; expires: number }>();
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  key?: string,
): Promise<T> {
  let fingerprint: string | undefined;
  if (method !== "GET" && !key) {
    const now = Date.now();
    for (const [id, entry] of pendingOperations)
      if (entry.expires < now) pendingOperations.delete(id);
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        method + ":" + path + ":" + JSON.stringify(body),
      ),
    );
    fingerprint = Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    const previous = pendingOperations.get(fingerprint);
    key = previous?.key ?? crypto.randomUUID();
    pendingOperations.set(fingerprint, { key, expires: now + 600000 });
    if (pendingOperations.size > 50)
      pendingOperations.delete(pendingOperations.keys().next().value!);
  }
  const response = await fetch(`/api/${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(method !== "GET"
        ? { "Idempotency-Key": key ?? crypto.randomUUID() }
        : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
  });
  const result = await response.json();
  if (
    !result ||
    typeof result.request_id !== "string" ||
    !("data" in result) ||
    !("error" in result)
  )
    throw new ApiError(
      "INVALID_RESPONSE",
      "服务返回格式无效；可重试同一操作",
      "",
    );
  if (fingerprint && (response.ok || response.status < 500))
    pendingOperations.delete(fingerprint);
  if (result.error)
    throw new ApiError(
      result.error.code,
      `${result.error.message}（请求 ${result.request_id}）`,
      result.request_id,
    );
  if (!response.ok)
    throw new ApiError(
      "HTTP_ERROR",
      `请求失败（${response.status}），可重试`,
      result.request_id,
    );
  return result.data;
}
